// src/hooks/useFlow.ts
// 主流程编排：四态串联 + 引擎 + 生成器 + 上下文
// v2.0：start 前异步调用 LLM 意图分析，降级时回退关键词匹配
// v2.1：上下文存储回读闭环 — start 时读 recent_qa 喂给 LLM，generate 时注入 preferences + recentQA
// RAG：finishAndGenerate 时通过向量检索注入相似历史 QA 增强上下文
import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/stores/appStore';
import { useEngineStore } from '@/stores/engineStore';
import { useContextStore } from '@/stores/contextStore';
import { questionLoader } from '@/engine/QuestionLoader';
import { QuestionEngine } from '@/engine/QuestionEngine';
import type { FlowMode, SceneChoice, Question } from '@/engine/types';
import { promptGenerator } from '@/engine/PromptGenerator';
import { pushRecentPrompt } from '@/components/RecentPromptList';
import type { PromptResult } from '@/types/prompt';
import type { Answer } from '@/types/state';
import type { IntentTag } from '@/types/intent-tag';
import type { ContextPreference, ContextRecentQA } from '@/types/context';
import { useAnalyticsStore } from '@/stores/analyticsStore';
import { useProjectStore } from '@/stores/projectStore';
import { useRequirementStore } from '@/stores/requirementStore';
import { extractCompletedTopics } from '@/engine/RequirementSyncer';
import {
  extractPreferencesFromQA,
  buildProfile,
  recommendAnswers,
  recommendFromPreferences,
} from '@/engine/PreferenceLearner';
import { v4 as uuidv4 } from 'uuid';
import { analyzeIntent } from '@/engine/LLMIntentAnalyzer';
import { evaluateFollowup, generateFollowupQuestion } from '@/engine/SmartFollowup';
import { retrieveSimilar } from '@/lib/vectorStore';
import { withTimeoutSafe } from '@/lib/withTimeout';
// #region debug-instrumentation
import { reportDebug, setDebugRunId } from '@/lib/debugReporter';
// 默认 pre；修复后切换为 post
setDebugRunId('post');
// #endregion debug-instrumentation

// 模块级单例：所有组件共享同一 engine 实例，避免组件切换时状态丢失
let engineInstance: QuestionEngine | null = null;

// v2.1 新增：本次 start 是否已经触发过动态追问（防重，每次 start 重置）
let followupTriggeredThisSession = false;

// P1-5 Bug 修复：start 调用序列号，用于取消过期的 LLM 分析后置 setState
// 每次 start 进入递增，await 后检查是否仍最新，否则 return
let startSeq = 0;

// B2 修复：动态追问外层兜底预算。
// generateFollowupQuestion 内部按 provider 有 8s/本地更长超时；此处再加一道
// 护栏，专门兜住 keyring/适配器初始化等非 adapter.chat 的挂起点，避免答题无限期阻塞。
const FOLLOWUP_BUDGET_MS = 15000;

function getEngine(): QuestionEngine {
  if (!engineInstance) {
    questionLoader.load();
    engineInstance = new QuestionEngine(questionLoader);
  }
  return engineInstance;
}

// v2.1 新增：哪些意图标签视为稳定用户偏好（用于累积到 context.preferences）
const PREFERENCE_LABELS = new Set([
  '场景',
  '主题',
  '响应式',
  '影响',
  '验证标准',
  '语言',
  '框架',
  '样式方案',
]);

/** v2.1 新增：从 engine 的 intentTags + LLM 分析中提取稳定偏好，准备写入 context.preferences */
function extractPreferencesFromEngine(engine: QuestionEngine): ContextPreference[] {
  const tags = engine.getIntentTags();
  const now = new Date().toISOString();
  const prefs: ContextPreference[] = [];
  const seen = new Set<string>();

  // 1. 从意图标签中提取稳定偏好
  for (const t of tags) {
    if (PREFERENCE_LABELS.has(t.label) && t.value && !seen.has(`${t.label}:${t.value}`)) {
      seen.add(`${t.label}:${t.value}`);
      prefs.push({ key: t.label, value: t.value, confirmed_at: now });
    }
  }

  // 2. 从 LLM 分析的 detected_dimensions 中补充
  const llmAnalysis = engine.getLLMAnalysis();
  if (llmAnalysis) {
    for (const dim of llmAnalysis.detected_dimensions) {
      const parts = dim.tag.split(':');
      if (parts.length >= 2) {
        const label = parts[0];
        const value = parts[1];
        if (PREFERENCE_LABELS.has(label) && !seen.has(`${label}:${value}`)) {
          seen.add(`${label}:${value}`);
          prefs.push({ key: label, value, confirmed_at: now });
        }
      }
    }
  }

  return prefs;
}

/** Task 11（C1 接线）：基于历史行为为指定问题计算推荐选项（同步轻量，无 IO、无需 await）
 *  数据源（均来自 contextStore，对应 PreferenceLearner 的两条推荐链路）：
 *  ① recent_qa 同题历史答案 → extractPreferencesFromQA + buildProfile + recommendAnswers
 *     （同题一致性 ≥ 60% 才推荐；历史 answer 存的是选项 label 或自定义文本，需解析回 option.value）
 *  ② preferences 稳定偏好 → recommendFromPreferences，按 "key:value" 匹配选项 tags（如 "场景: 修UI"）
 *  返回推荐选项的 value 数组（空数组 = 无推荐）；新用户两源皆空时短路返回，避免无谓的 store 写入 */
function computeRecommendation(
  question: Question,
  recentQA: ContextRecentQA[],
  prefs: ContextPreference[],
): string[] {
  if (recentQA.length === 0 && prefs.length === 0) return [];

  const values = new Set<string>();

  // ① QA 历史画像推荐：questionId 直接匹配历史答题记录
  const qaEntries = extractPreferencesFromQA(recentQA);
  const recAnswer = recommendAnswers(buildProfile(qaEntries), [question.id]).get(question.id);
  if (recAnswer) {
    for (const opt of question.options) {
      if (opt.value === recAnswer || opt.label === recAnswer) values.add(opt.value);
    }
  }

  // ② 稳定偏好推荐：minCount=1（contextStore.appendPreferences 对同 key 去重，
  //    每个key仅存最新一条、count 恒为 1，默认 minCount=2 永不命中）
  const prefRecs = recommendFromPreferences(prefs, 1);
  if (prefRecs.size > 0) {
    for (const opt of question.options) {
      // 选项 tags 为 "label: value" 格式，与偏好 key/value 做去空格归一化后比较
      const normalizedTags = opt.tags.map((t) => t.replace(/\s+/g, ''));
      for (const [key, val] of prefRecs) {
        if (normalizedTags.includes(`${key}:${val}`.replace(/\s+/g, ''))) {
          values.add(opt.value);
        }
      }
    }
  }

  return [...values];
}

export function useFlow() {
  const appState = useAppStore((s) => s.state);
  const transition = useAppStore((s) => s.transition);
  const openSkipConfirm = useAppStore((s) => s.openSkipConfirm);

  // v2.3 新增：跟踪组件挂载状态，防止 await 期间组件卸载后继续 setState（React 18 警告/内存泄漏）
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // v2.3：用 useShallow 选 actions，actions 引用稳定不会因状态变化触发重渲染
  const {
    setStage,
    setCurrentQuestion,
    addAsked,
    recordAnswer,
    addIntentTag,
    removeIntentTag: removeTagStore,
    setSeedInput,
    incSkip,
    resetSkip,
    setResult,
    reset: resetEngineStore,
    setCanUndo,
    setRecommendations,
  } = useEngineStore(
    useShallow((s) => ({
      setStage: s.setStage,
      setCurrentQuestion: s.setCurrentQuestion,
      addAsked: s.addAsked,
      recordAnswer: s.recordAnswer,
      addIntentTag: s.addIntentTag,
      removeIntentTag: s.removeIntentTag,
      setSeedInput: s.setSeedInput,
      incSkip: s.incSkip,
      resetSkip: s.resetSkip,
      setResult: s.setResult,
      reset: s.reset,
      setCanUndo: s.setCanUndo,
      setRecommendations: s.setRecommendations,
    })),
  );

  // v2.3：ctxStore 只用 actions，用 useShallow 选 actions 避免订阅 ctx 状态变化
  const ctxStore = useContextStore(
    useShallow((s) => ({
      appendRecentQA: s.appendRecentQA,
      appendRecentQAs: s.appendRecentQAs,
      getRecentQA: s.getRecentQA,
      getPreferences: s.getPreferences,
      setIntentTags: s.setIntentTags,
      setLastPrompt: s.setLastPrompt,
      appendPreferences: s.appendPreferences,
      clear: s.clear,
    })),
  );

  // v2.3 新增：批量缓冲本次会话中产生的 recentQA，finishAndGenerate 时一次性持久化，减少 IO 次数
  const pendingRecentQARef = useRef<Array<{ question_id: string; question_text: string; answer: string; answered_at: string }>>([]);
  // v2.3 新增：辅助函数，获取最近 QA（含未持久化的 pending 条目）
  const getRecentQAWithPending = useCallback((limit?: number) => {
    const persisted = ctxStore.getRecentQA(limit ? limit + pendingRecentQARef.current.length : undefined);
    const combined = [...persisted, ...pendingRecentQARef.current];
    return typeof limit === 'number' ? combined.slice(-limit) : combined;
  }, [ctxStore]);
  const projectFingerprint = useProjectStore((s) => s.fingerprint);
  const fullScanResult = useProjectStore((s) => s.fullScanResult);
  // M11：从需求同步器提取已完成子任务主题，供 Selector 进度去重
  const completedTopics = useRequirementStore((s) => extractCompletedTopics(s.requirements));

  /** 启动提问（v2.0：异步调用 LLM 意图分析后启动引擎）
   *  v2.1：从 contextStore 读取 recent_qa 喂给 LLM，提升分析连续性
   *  v2.2：重置本次会话的动态追问标记
   *  P1-5 修复：用 startSeq 序列号取消过期 LLM 分析后的 setState，避免快速重复 start 导致状态错乱
   */
  const start = useCallback(
    async (seed: string, mode: FlowMode = 'full', sceneChoice: SceneChoice = 'auto') => {
      const engine = getEngine();
      resetEngineStore();
      // v2.2：每次 start 重置追问标记
      followupTriggeredThisSession = false;
      // v2.3：新会话开始时清空 pending recentQA（上一会话未 flush 的数据不应混入新会话）
      pendingRecentQARef.current = [];
      // P1-5：进入时递增序列号，await 后若 seq 不再匹配则放弃本次 setState
      const mySeq = ++startSeq;

      // 三模式系统：立即切换到 question 态显示 loading（避免 await LLM 期间用户感知"无响应"）
      // QuestionPanel 在 currentQuestion 为 null 时显示 loading spinner
      transition('question');

      // v2.1：从 contextStore 读取最近问答历史，喂给 LLM 提供连续性
      // v2.3：包含本次会话尚未持久化的 pending QA，保证连续性不丢失
      const recentQA = getRecentQAWithPending(8).map((qa) => ({
        question: qa.question_text,
        answer: qa.answer,
      }));
      // r4增强：同时传给 engine.start 用于上下文加权（即使无 LLM 也能跨会话记忆）
      const recentQAForEngine = getRecentQAWithPending(8).map((qa) => ({
        question_text: qa.question_text,
        answer: qa.answer,
      }));

      // P0-1（超时修复）：首题立即用规则路由出题，不再阻塞等待 LLM 意图分析
      // 之前：await analyzeIntent（云端8s/本地30s）期间 UI 卡在"正在生成提示词"，12s 后触发超时弹窗
      // 现在：先用规则路由立即出题；LLM 分析并行执行，返回后延迟应用（换题/增强后续选题）
      let firstQuestion: Question | null = null;
      try {
        firstQuestion = engine.start(seed, mode, null, recentQAForEngine, sceneChoice, completedTopics);
        setSeedInput(seed);
        setStage(engine.getStage());
        if (firstQuestion) {
          setCurrentQuestion(firstQuestion);
          addAsked(firstQuestion.id);
          // Task 11（C1 接线）：PreferenceLearner 基于历史 QA + 偏好为首题计算推荐选项
          // 同步轻量无需 await；无历史（新用户）或无命中时不写入，避免无谓渲染
          const firstRecs = computeRecommendation(
            firstQuestion,
            getRecentQAWithPending(),
            ctxStore.getPreferences(),
          );
          if (firstRecs.length > 0) setRecommendations(firstQuestion.id, firstRecs);
        } else {
          // engine.start 返回 null（首题缺失），回退到 expanded 避免卡在 loading
          console.error('[useFlow] engine.start 返回 null，首题缺失，回退到 expanded');
          transition('expanded');
          return;
        }
        // 同步种子阶段产出的意图标签到 store
        for (const tag of engine.getIntentTags()) {
          addIntentTag(tag);
        }
        setCanUndo(false);
        // 记录路由命中分析数据
        const recordHit = useAnalyticsStore.getState().recordHit;
        recordHit({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          seed,
          routeSource: engine.getRouteSource(),
          matchedKeywords: engine.getMatchedKeywords(),
          matchedClusterIds: engine.getMatchedClusterIds(),
          matchedClusterForms: engine.getMatchedClusters().map((m) => m.matched_form),
          firstQuestionId: firstQuestion?.id ?? null,
          firstQuestionStage: firstQuestion?.stage ?? null,
          hasDynamicClarification: engine.getHasDynamicClarification(),
          topTagScores: engine
            .getTagScores()
            .slice(0, 5)
            .map((s) => ({ tag: s.tag, weight: s.weight })),
        });
        transition('question');
      } catch (e) {
        console.error('[useFlow] start 内部异常，回退到 expanded', e);
        transition('expanded');
        return;
      }

      // P0-1：LLM 意图分析并行执行，不阻塞首题展示
      // 返回后仅当本次 start 仍有效时才应用（换题/增强），避免过期结果覆盖新会话
      if (sceneChoice === 'auto') {
        void (async () => {
          try {
            const projectStack = projectFingerprint
              ? [projectFingerprint.framework, projectFingerprint.language, projectFingerprint.css_solution]
                  .filter(Boolean)
                  .join(' / ')
              : undefined;
            const llmAnalysis = await analyzeIntent(
              seed,
              projectStack,
              recentQA,
              mode === 'quick' ? 'quick' : 'full',
            );
            // P1-5：await 期间若用户已再次 start，放弃本次
            if (mySeq !== startSeq) return;
            // v2.3：组件卸载后不再继续
            if (!mountedRef.current) return;
            if (!llmAnalysis) return;

            const { replaced, question } = engine.applyLLMAnalysis(llmAnalysis);
            // 同步 engine 的意图标签（含 LLM 补充）到 store
            useEngineStore.getState().setIntentTags(engine.getIntentTags());
            if (replaced && question) {
              // 换题：更新 UI 到 LLM 路由的首题
              setCurrentQuestion(question);
              addAsked(question.id);
              setStage(engine.getStage());
              // Task 11：换题后为新首题重新计算推荐选项（此前只算了规则路由的首题）
              const replacedRecs = computeRecommendation(
                question,
                getRecentQAWithPending(),
                ctxStore.getPreferences(),
              );
              if (replacedRecs.length > 0) setRecommendations(question.id, replacedRecs);
            }
          } catch (e) {
            console.warn('[useFlow] LLM 意图分析失败，保持规则路由', e);
          }
        })();
      }
    },
    [resetEngineStore, setSeedInput, setStage, setCurrentQuestion, addAsked, addIntentTag, setRecommendations, transition, projectFingerprint, ctxStore, completedTopics],
  );

  /** 提交答案
   *  v2.2：在引擎计算 nextQuestion 后，调用 SmartFollowup 评估是否插入动态追问题
   *  P2-1 修复：移除 'unknown' 兜底，避免污染上下文；空时不写 recent_qa
   */
  const answer = useCallback(
    async (value: string, raw: string, optionTags: string[]) => {
      const engine = getEngine();
      const result = engine.answer(value, raw, optionTags);
      // 同步最新 answer 到 store
      const allAnswers = engine.getAnswers();
      const lastKey = Object.keys(allAnswers).pop();
      if (lastKey) recordAnswer(allAnswers[lastKey]);

      // 同步标签
      for (const t of result.extractedTags) addIntentTag(t);
      setStage(engine.getStage());
      setCurrentQuestion(result.nextQuestion);
      if (result.nextQuestion) {
        addAsked(result.nextQuestion.id);
        // Task 11（C1 接线）：切换到下一题时基于历史 QA + 偏好计算推荐选项
        // （含本会话 pending 答案，goBack 后重答同一题的记录也计入频率统计）
        const nextRecs = computeRecommendation(
          result.nextQuestion,
          getRecentQAWithPending(),
          ctxStore.getPreferences(),
        );
        if (nextRecs.length > 0) setRecommendations(result.nextQuestion.id, nextRecs);
      }

      // P2-1：仅当有明确 answeredId 时写 recent_qa，避免 'unknown' 污染上下文
      if (lastKey) {
        const answeredQuestion = questionLoader.getQuestionById(lastKey);
        const userAnswerText = raw || value;
        // v2.3：改为写入 pending 缓冲，finishAndGenerate 时批量持久化，减少 IO
        pendingRecentQARef.current.push({
          question_id: lastKey,
          question_text: answeredQuestion?.text ?? '',
          answer: userAnswerText,
          answered_at: new Date().toISOString(),
        });

        // v2.2：如果未完成且未触发过追问，评估是否插入动态追问题
        if (
          !result.isComplete &&
          result.nextQuestion &&
          !followupTriggeredThisSession &&
          answeredQuestion // 需要原题引用（用于 isCustomAnswer 判断）
        ) {
          const decision = evaluateFollowup({
            llmAnalysis: engine.getLLMAnalysis(),
            lastAnswer: allAnswers[lastKey] ?? { questionId: lastKey, value, raw, tags: optionTags, skipped: false, answeredAt: new Date().toISOString() },
            lastQuestion: answeredQuestion,
            nextQuestion: result.nextQuestion,
            allAnswers,
            alreadyTriggered: followupTriggeredThisSession,
            recentQA: getRecentQAWithPending(5),
            seed: engine.getSeedInput(),
            mode: engine.getMode(),
          });

          if (decision) {
            // B6 会话代际防护：记录本次 start 的序号。await 期间若发生 restart
            // （startSeq 已递增），旧会话的追问结果一律作废——既不能插入新会话，
            // 也不能触发旧会话的 finishAndGenerate，防止跨会话污染。
            const sessionSeq = startSeq;
            // B2 修复：外层再包一层 withTimeoutSafe 兜底。
            // generateFollowupQuestion 内部的 8s 超时只覆盖 adapter.chat，若 keyring/
            // 适配器初始化本身挂起，会被这里的预算兜住，答题绝不无限期阻塞。
            // 超时 → ok=false，followup=null，继续走完成/下一步逻辑。
            const followupResult = await withTimeoutSafe<{ question: Question; reason: string } | null>(
              generateFollowupQuestion(decision),
              FOLLOWUP_BUDGET_MS,
              'generateFollowup',
              null,
            );
            // B6：代际校验，过期直接丢弃
            if (sessionSeq !== startSeq) return;
            const followup = followupResult.value;
            // #region debug-point answer.followup (H5)
            reportDebug({ point: 'answer.followup.afterAwait', phase: 'info', hypothesisId: 'H5', data: { mounted: mountedRef.current, hasFollowup: !!followup, isComplete: result.isComplete, hasNext: !!result.nextQuestion } });
            // #endregion debug-point answer.followup (H5)
            // B3 修复：移除 mountedRef 早期 return。setCurrentQuestion/addAsked/setStage
            // 均为 zustand store 动作，卸载后调用安全（非 React setState）。
            // 原实现若在此 return，会在「末题 + 卸载」时跳过下方完成判定，导致用户已答完
            // 却永不生成结果。现在正常向下执行：有追问则入队展示，无则走完成链路。
            if (followup) {
              // 插入追问题，覆盖原本的 nextQuestion（store 写入，卸载后下次展开仍生效）
              engine.insertFollowup(followup.question);
              setCurrentQuestion(followup.question);
              addAsked(followup.question.id);
              setStage(engine.getStage());
              followupTriggeredThisSession = true;
              console.info('[useFlow] 动态追问已插入', {
                trigger: decision.trigger,
                reason: followup.reason,
                question_text: followup.question.text,
              });
              setCanUndo(engine.canUndo());
              return; // 展示追问题，不继续 finishAndGenerate
            }
          }
        }
      }

      if (result.isComplete || !result.nextQuestion) {
        // v2.3：显式 await，保证 finishAndGenerate 内部的 ctxStore 写入完成
        // #region debug-point answer.finishAndGenerate (H5)
        reportDebug({ point: 'answer.callingFinishAndGenerate', phase: 'start', hypothesisId: 'H5', data: { isComplete: result.isComplete, hasNext: !!result.nextQuestion } });
        // #endregion debug-point answer.finishAndGenerate (H5)
        await finishAndGenerate();
      } else {
        setCanUndo(engine.canUndo());
      }
    },
    [setStage, setCurrentQuestion, addAsked, addIntentTag, recordAnswer, setRecommendations, ctxStore, setCanUndo],
  );

  /** 跳过当前题
   *  v2.3：改为 async，显式 await finishAndGenerate()，避免未捕获的 Promise 拒绝
   *  P2-1：仅在有 lastKey 时写 recent_qa
   */
  const skip = useCallback(async () => {
    const engine = getEngine();
    const result = engine.skip();
    const lastAns = engine.getAnswers();
    const lastKey = Object.keys(lastAns).pop();
    if (lastKey) recordAnswer(lastAns[lastKey]);
    incSkip();
    setStage(engine.getStage());
    setCurrentQuestion(result.nextQuestion);
    if (result.nextQuestion) addAsked(result.nextQuestion.id);

    // P2-1：skip 时不写 recent_qa（用户跳过，无有效答案）
    if (result.isComplete || !result.nextQuestion) {
      // v2.3：显式 await，保证生成完成；若卸载则不再 setCanUndo
      await finishAndGenerate();
      if (!mountedRef.current) return;
    } else if (result.needSkipConfirm) {
      openSkipConfirm();
    }
    setCanUndo(engine.canUndo());
  }, [recordAnswer, incSkip, setStage, setCurrentQuestion, addAsked, openSkipConfirm, setCanUndo]);

  /** 用户在二次确认中选择"继续提问" */
  const continueAfterSkipConfirm = useCallback(() => {
    resetSkip();
  }, [resetSkip]);

  /** 生成提示词并进入结果态
   *  v2.1：注入 recentQA + preferences 上下文，并在生成后累积用户新偏好
   *  P3：传递 mode 给 PromptGenerator，quick 模式下 verify 段无答案时自动推断
   *  RAG：通过向量检索注入相似历史 QA 增强上下文
   *  注意：必须定义在 finishEarlyAndGenerate 之前，因为后者引用它
   */
  /** 生成提示词并进入结果态
   *  v3.0 重构：transition('result') 尽早执行，持久化移到后台不阻塞 UI
   *  - retrieveSimilar 2s 超时（非关键 RAG 增强）
   *  - setResult 后立即 transition，用户秒级看到结果
   *  - appendRecentQAs/setIntentTags/setLastPrompt/appendPreferences 后台异步执行
   *  - 读取 recentQA 时合并 persisted + pending，不依赖 appendRecentQAs 先完成
   */
  /** 生成提示词并进入结果态
   *  v3.0 重构：transition('result') 尽早执行，持久化移到后台不阻塞 UI
   *  v3.1 安全加固：5s 硬超时兜底 + 顶层 try/catch，确保任何异常都不永久卡住
   *  - retrieveSimilar 2s 超时（非关键 RAG 增强）
   *  - setResult 后立即 transition，用户秒级看到结果
   *  - appendRecentQAs/setIntentTags/setLastPrompt/appendPreferences 后台异步执行
   *  - 读取 recentQA 时合并 persisted + pending，不依赖 appendRecentQAs 先完成
   *  - 5s 硬超时：任何原因导致未在 5s 内 transition，强制回到 expanded
   */
  const finishAndGenerate = useCallback(async () => {
    // 5s 硬超时兜底：任何原因导致 finishAndGenerate 未在 5s 内 transition，强制回到 expanded
    let transitioned = false;
    const hardFallback = setTimeout(() => {
      if (!transitioned) {
        console.warn('[useFlow] finishAndGenerate 5s 硬超时，强制 transition 到 expanded');
        try { useAppStore.getState().transition('expanded'); } catch (fe) { console.error('[useFlow] hardFallback transition failed', fe); }
      }
    }, 5000);

    try {
      const engine = getEngine();
      const snap = engine.snapshot();
      // #region debug-point finishAndGenerate.enter
      reportDebug({ point: 'finishAndGenerate.enter', phase: 'start', hypothesisId: 'H1', data: { pendingQA: pendingRecentQARef.current.length, hasResult: !!useEngineStore.getState().result, appState: useAppStore.getState().state } });
      // #endregion debug-point finishAndGenerate.enter

      // 读取上下文（合并 persisted + pending，不依赖 appendRecentQAs 先完成）
      const persistedQA = ctxStore.getRecentQA(20);
      const recentQA = [...persistedQA, ...pendingRecentQARef.current].slice(-20);
      const preferences = ctxStore.getPreferences();
      const engineMode = engine.getMode();
      const genMode = engineMode === 'quick' ? 'quick' : 'full';

      // RAG：通过向量检索获取相似历史 QA（2s 超时，非关键，降级返回空）
      let retrievedContext: Array<{ question: string; answer: string; score: number }> = [];
      try {
        const seedInput = snap.seedInput;
        if (seedInput && seedInput.trim().length > 2) {
          // #region debug-point retrieveSimilar (H3)
          reportDebug({ point: 'retrieveSimilar.start', phase: 'start', hypothesisId: 'H3' });
          const ragStart = performance.now();
          const results = await Promise.race([
            retrieveSimilar(seedInput, 3),
            new Promise<[]>((resolve) => setTimeout(() => resolve([]), 2000)),
          ]);
          reportDebug({ point: 'retrieveSimilar.end', phase: 'end', hypothesisId: 'H3', data: { durationMs: Math.round(performance.now() - ragStart), count: results.length } });
          // #endregion debug-point retrieveSimilar (H3)
          retrievedContext = results.map((r) => ({
            question: r.entry.metadata.questionText,
            answer: r.entry.metadata.answer,
            score: r.score,
          }));
        }
      } catch (e) {
        console.warn('[useFlow] 向量检索失败，降级到无 RAG 模式', e);
        reportDebug({ point: 'retrieveSimilar.error', phase: 'error', hypothesisId: 'H3', error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
      }

      // 生成提示词（同步）— 失败时回退到 expanded 避免永久 loading
      let prompt: PromptResult;
      try {
        // #region debug-point promptGenerator.generate (H4)
        reportDebug({ point: 'promptGenerator.generate.start', phase: 'start', hypothesisId: 'H4' });
        prompt = promptGenerator.generate({
          intentTags: snap.intentTags,
          answers: snap.answers,
          seedInput: snap.seedInput,
          project: projectFingerprint,
          scanResult: fullScanResult,
          recentQA,
          preferences,
          mode: genMode,
          retrievedContext,
          // 三模式系统：传入场景类型 + 问题阶段映射
          scene: engine.getScene(),
          questionStageMap: engine.getQuestionStageMap(),
          // Task 8：注入用户选择的目标工具（getState 读取，避免订阅导致重渲染）
          targetTool: useAppStore.getState().targetTool,
        });
        reportDebug({ point: 'promptGenerator.generate.end', phase: 'end', hypothesisId: 'H4' });
        // #endregion debug-point promptGenerator.generate (H4)
      } catch (genErr) {
        console.error('[useFlow] 提示词生成失败，回退到 expanded', genErr);
        reportDebug({ point: 'promptGenerator.generate.error', phase: 'error', hypothesisId: 'H4', error: genErr instanceof Error ? `${genErr.name}: ${genErr.message}` : String(genErr) });
        transitioned = true;
        clearTimeout(hardFallback);
        transition('expanded');
        return;
      }

      // ★ 立即设置 result 并 transition（用户尽快看到结果，不被持久化阻塞）
      setResult(prompt);
      transitioned = true;
      clearTimeout(hardFallback);
      transition('result');
      reportDebug({ point: 'finishAndGenerate.transitionResult', phase: 'info', hypothesisId: 'H1', data: { hasResult: true, finalAppState: useAppStore.getState().state } });

      // B2 修复：同步捕获 pending QA 快照并立刻清空 ref。
      // 若留到后台 async 里才读取，restart()/directGenerate() 可能先清空
      // pendingRecentQARef，导致本次持久化丢数据（restart 与 finish 并发竞态）。
      const pendingSnapshot = pendingRecentQARef.current;
      pendingRecentQARef.current = [];

      // ★ 后台持久化（不阻塞 UI，失败只记录日志）
      // flush pending recentQA + setIntentTags + setLastPrompt + appendPreferences + pushRecentPrompt
      void (async () => {
        try {
          // flush pending recentQA 到持久化
          if (pendingSnapshot.length > 0) {
            await withTimeoutSafe(
              ctxStore.appendRecentQAs(pendingSnapshot),
              8000,
              'appendRecentQAs',
              undefined as void,
            );
          }
          await withTimeoutSafe(ctxStore.setIntentTags(snap.intentTags), 5000, 'setIntentTags', undefined as void);
          await withTimeoutSafe(ctxStore.setLastPrompt(promptGenerator.toMarkdown(prompt)), 5000, 'setLastPrompt', undefined as void);
          // v2.1：累积本次提问沉淀的稳定偏好（场景/主题/响应式等）
          const newPrefs = extractPreferencesFromEngine(engine);
          if (newPrefs.length > 0) {
            await withTimeoutSafe(ctxStore.appendPreferences(newPrefs), 5000, 'appendPreferences', undefined as void);
          }
          pushRecentPrompt(promptGenerator.toMarkdown(prompt));
          reportDebug({ point: 'finishAndGenerate.backgroundPersist.done', phase: 'end', hypothesisId: 'H2' });
        } catch (e) {
          console.warn('[useFlow] 后台持久化失败', e);
          reportDebug({ point: 'finishAndGenerate.backgroundPersist.error', phase: 'error', hypothesisId: 'H2', error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
        }
      })();
    } catch (e) {
      // 顶层 catch：任何未预见的异常都不应让用户永久卡在 loading 界面
      console.error('[useFlow] finishAndGenerate unhandled error，回退到 expanded', e);
      transitioned = true;
      clearTimeout(hardFallback);
      try { transition('expanded'); } catch (te) { console.error('[useFlow] 顶层 catch transition failed', te); }
    }
  }, [setResult, ctxStore, transition, projectFingerprint, fullScanResult]);

  /** 用户在二次确认中选择"结束并生成"
   *  P1-2 修复：改为 async 并 await finishAndGenerate，避免 unhandled rejection
   */
  const finishEarlyAndGenerate = useCallback(async () => {
    const engine = getEngine();
    engine.finishEarly();
    resetSkip();
    await finishAndGenerate();
  }, [resetSkip, finishAndGenerate]);

  /** 直接生成：跳过所有问题，仅基于种子输入+意图提取生成提示词 */
  const directGenerate = useCallback(
    async (seed: string, sceneChoice: SceneChoice = 'auto') => {
      const engine = getEngine();
      resetEngineStore();
      // 三模式系统：立即切换到 question 态显示 loading（避免生成期间用户感知"无响应"）
      transition('question');
      // 异常防护：任何步骤失败都回退到 expanded，避免永久 loading
      try {
        // 清空上下文，避免上次会话的 QA 污染本次生成
        await ctxStore.clear();
        engine.start(seed, 'direct', null, [], sceneChoice, completedTopics);
        setSeedInput(seed);
        setStage(engine.getStage());
        for (const tag of engine.getIntentTags()) {
          addIntentTag(tag);
        }
        const recordHit = useAnalyticsStore.getState().recordHit;
        recordHit({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          seed,
          routeSource: engine.getRouteSource(),
          matchedKeywords: engine.getMatchedKeywords(),
          matchedClusterIds: engine.getMatchedClusterIds(),
          matchedClusterForms: engine.getMatchedClusters().map((m) => m.matched_form),
          firstQuestionId: null,
          firstQuestionStage: null,
          hasDynamicClarification: engine.getHasDynamicClarification(),
          topTagScores: engine
            .getTagScores()
            .slice(0, 5)
            .map((s) => ({ tag: s.tag, weight: s.weight })),
        });
        await finishAndGenerate();
      } catch (e) {
        console.error('[useFlow] directGenerate 异常，回退到 expanded', e);
        transition('expanded');
      }
    },
    [resetEngineStore, ctxStore, setSeedInput, setStage, addIntentTag, finishAndGenerate, transition],
  );

  /** 删除意图标签后重生成
   *  v2.1：保留上下文 recentQA + preferences
   */
  const removeTag = useCallback(
    async (id: string) => {
      removeTagStore(id);
      const engine = getEngine();
      const remaining = engine.removeIntentTag(id);
      if (appState === 'result') {
        const recentQA = ctxStore.getRecentQA(20);
        const preferences = ctxStore.getPreferences();
        const prompt = promptGenerator.regenerate(
          remaining,
          engine.getAnswers(),
          engine.getSeedInput(),
          projectFingerprint,
          { scanResult: fullScanResult, recentQA, preferences, scene: engine.getScene(), questionStageMap: engine.getQuestionStageMap(), targetTool: useAppStore.getState().targetTool },
        );
        setResult(prompt);
        await ctxStore.setIntentTags(remaining);
        await ctxStore.setLastPrompt(promptGenerator.toMarkdown(prompt));
      }
    },
    [removeTagStore, appState, promptGenerator, setResult, ctxStore, projectFingerprint, fullScanResult],
  );

  /** 添加截图诊断产出的标签
   *  v2.1：保留上下文 recentQA + preferences
   */
  const addScreenshotTags = useCallback(
    async (tags: IntentTag[]) => {
      const engine = getEngine();
      for (const t of tags) {
        engine.addIntentTag(t);
        addIntentTag(t);
      }
      // 实时从 store 读取状态，避免闭包中 appState 过期（directGenerate 完成后 appState 已变为 'result'，但闭包可能仍是旧值）
      const currentState = useAppStore.getState().state;
      if (currentState === 'result') {
        // 异常防护：持久化失败不应阻塞 UI，prompt 生成失败时保留旧结果
        try {
          const recentQA = ctxStore.getRecentQA(20);
          const preferences = ctxStore.getPreferences();
          const prompt = promptGenerator.generate({
            intentTags: engine.getIntentTags(),
            answers: engine.getAnswers(),
            seedInput: engine.getSeedInput(),
            project: projectFingerprint,
            scanResult: fullScanResult,
            recentQA,
            preferences,
            // 三模式系统：传入场景类型 + 问题阶段映射
            scene: engine.getScene(),
            questionStageMap: engine.getQuestionStageMap(),
            // Task 8：注入用户选择的目标工具（getState 读取，避免订阅导致重渲染）
            targetTool: useAppStore.getState().targetTool,
          });
          setResult(prompt);
          await ctxStore.setIntentTags(engine.getIntentTags());
        await ctxStore.setLastPrompt(promptGenerator.toMarkdown(prompt));
        } catch (e) {
          console.error('[useFlow] addScreenshotTags 重生成失败，保留旧结果', e);
        }
      }
    },
    [addIntentTag, appState, promptGenerator, setResult, ctxStore, projectFingerprint, fullScanResult],
  );

  /** v1.2 新增：返回上一题（撤销最后一次回答） */
  const goBack = useCallback(() => {
    const engine = getEngine();
    const result = engine.undoLastAnswer();
    if (!result.restored) return;
    setStage(result.stage);
    setCurrentQuestion(result.current);
    setCanUndo(engine.canUndo());
    // 同步 store 状态（askedIds/answers/intentTags）
    const snap = engine.snapshot();
    // 用 setIntentTags 一次性替换（防止旧的意图标签残留）
    useEngineStore.getState().setIntentTags(snap.intentTags);
    // 同步 answers
    const cur = useEngineStore.getState();
    for (const key of Object.keys(cur.answers)) {
      if (!(key in snap.answers)) {
        cur.removeAnswer(key);
      }
    }
  }, [setStage, setCurrentQuestion, setCanUndo]);

  /** v1.2 新增：结果页分块编辑 — 更新某个段落的 content */
  const updateSection = useCallback(
    async (segmentKey: 'action' | 'spec' | 'constraint' | 'verify', newContent: string) => {
      const cur = useEngineStore.getState().result;
      if (!cur) return;
      const next = promptGenerator.updateSection(cur, segmentKey, newContent);
      setResult(next);
      await ctxStore.setLastPrompt(promptGenerator.toMarkdown(next));
    },
    [setResult, ctxStore],
  );

  /** 重新提问
   *  P1-1 修复：ctxStore.clear() 是 async，未处理会漂浮 Promise；用 catch 兜底
   */
  const restart = useCallback(() => {
    const engine = getEngine();
    engine.reset();
    resetEngineStore();
    // P1-1：清空上下文，避免上次会话的 QA 污染新一轮提问；显式 catch 防止 unhandled rejection
    void ctxStore.clear().catch((e) => {
      console.warn('[useFlow] 清空上下文失败', e);
    });
    transition('expanded');
  }, [resetEngineStore, ctxStore, transition]);

  /** 复制到剪贴板 */
  const copyPrompt = useCallback(
    async (result: PromptResult): Promise<boolean> => {
      return promptGenerator.copyToClipboard(result);
    },
    [promptGenerator],
  );

  /** 导出 Markdown */
  const exportPrompt = useCallback(
    (result: PromptResult) => {
      promptGenerator.exportMd(result);
    },
    [promptGenerator],
  );

  return {
    start,
    directGenerate,
    answer,
    skip,
    goBack,
    updateSection,
    continueAfterSkipConfirm,
    finishEarlyAndGenerate,
    removeTag,
    addScreenshotTags,
    restart,
    copyPrompt,
    exportPrompt,
  };
}

// 类型导出供其他模块使用
export type { Answer, IntentTag };
