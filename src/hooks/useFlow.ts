// src/hooks/useFlow.ts
// 主流程编排：四态串联 + 引擎 + 生成器 + 上下文
// v2.0：start 前异步调用 LLM 意图分析，降级时回退关键词匹配
// v2.1：上下文存储回读闭环 — start 时读 recent_qa 喂给 LLM，generate 时注入 preferences + recentQA
import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/stores/appStore';
import { useEngineStore } from '@/stores/engineStore';
import { useContextStore } from '@/stores/contextStore';
import { questionLoader } from '@/engine/QuestionLoader';
import { QuestionEngine } from '@/engine/QuestionEngine';
import type { FlowMode } from '@/engine/types';
import { promptGenerator } from '@/engine/PromptGenerator';
import { pushRecentPrompt } from '@/components/RecentPromptList';
import type { PromptResult } from '@/types/prompt';
import type { Answer } from '@/types/state';
import type { IntentTag } from '@/types/intent-tag';
import type { ContextPreference } from '@/types/context';
import { useAnalyticsStore } from '@/stores/analyticsStore';
import { useProjectStore } from '@/stores/projectStore';
import { v4 as uuidv4 } from 'uuid';
import { analyzeIntent } from '@/engine/LLMIntentAnalyzer';
import { evaluateFollowup, generateFollowupQuestion } from '@/engine/SmartFollowup';

// 模块级单例：所有组件共享同一 engine 实例，避免组件切换时状态丢失
let engineInstance: QuestionEngine | null = null;

// v2.1 新增：本次 start 是否已经触发过动态追问（防重，每次 start 重置）
let followupTriggeredThisSession = false;

// P1-5 Bug 修复：start 调用序列号，用于取消过期的 LLM 分析后置 setState
// 每次 start 进入递增，await 后检查是否仍最新，否则 return
let startSeq = 0;

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
    })),
  );

  // v2.3：ctxStore 只用 actions，用 useShallow 选 actions 避免订阅 ctx 状态变化
  const ctxStore = useContextStore(
    useShallow((s) => ({
      appendRecentQA: s.appendRecentQA,
      getRecentQA: s.getRecentQA,
      getPreferences: s.getPreferences,
      setIntentTags: s.setIntentTags,
      setLastPrompt: s.setLastPrompt,
      appendPreferences: s.appendPreferences,
      clear: s.clear,
    })),
  );
  const projectFingerprint = useProjectStore((s) => s.fingerprint);

  /** 启动提问（v2.0：异步调用 LLM 意图分析后启动引擎）
   *  v2.1：从 contextStore 读取 recent_qa 喂给 LLM，提升分析连续性
   *  v2.2：重置本次会话的动态追问标记
   *  P1-5 修复：用 startSeq 序列号取消过期 LLM 分析后的 setState，避免快速重复 start 导致状态错乱
   */
  const start = useCallback(
    async (seed: string, mode: FlowMode = 'full') => {
      const engine = getEngine();
      resetEngineStore();
      // v2.2：每次 start 重置追问标记
      followupTriggeredThisSession = false;
      // P1-5：进入时递增序列号，await 后若 seq 不再匹配则放弃本次 setState
      const mySeq = ++startSeq;

      // v2.1：从 contextStore 读取最近问答历史，喂给 LLM 提供连续性
      // 注意：不等待 load()，因为 ctxStore 通常在 App 启动时已 load
      const recentQA = ctxStore.getRecentQA(8).map((qa) => ({
        question: qa.question_text,
        answer: qa.answer,
      }));
      // r4增强：同时传给 engine.start 用于上下文加权（即使无 LLM 也能跨会话记忆）
      const recentQAForEngine = ctxStore.getRecentQA(8).map((qa) => ({
        question_text: qa.question_text,
        answer: qa.answer,
      }));

      // v2.0：异步调用 LLM 意图分析（8 秒超时，降级返回 null）
      // P3 快速通道：quick 模式下超时降至 4s
      let llmAnalysis = null;
      try {
        const projectStack = projectFingerprint
          ? [projectFingerprint.framework, projectFingerprint.language, projectFingerprint.css_solution]
              .filter(Boolean)
              .join(' / ')
          : undefined;
        llmAnalysis = await analyzeIntent(
          seed,
          projectStack,
          recentQA,
          mode === 'quick' ? 'quick' : 'full',
        );
      } catch (e) {
        console.warn('[useFlow] LLM 意图分析失败，降级到关键词匹配', e);
      }

      // P1-5：await 期间若用户已再次 start，放弃本次后续操作
      if (mySeq !== startSeq) return;
      // v2.3：组件卸载后也不再继续
      if (!mountedRef.current) return;

      const q = engine.start(seed, mode, llmAnalysis, recentQAForEngine);
      setSeedInput(seed);
      setStage(engine.getStage());
      if (q) {
        setCurrentQuestion(q);
        addAsked(q.id);
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
        firstQuestionId: q?.id ?? null,
        firstQuestionStage: q?.stage ?? null,
        hasDynamicClarification: engine.getHasDynamicClarification(),
        topTagScores: engine
          .getTagScores()
          .slice(0, 5)
          .map((s) => ({ tag: s.tag, weight: s.weight })),
      });
      transition('question');
    },
    [resetEngineStore, setSeedInput, setStage, setCurrentQuestion, addAsked, addIntentTag, transition, projectFingerprint, ctxStore],
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
      if (result.nextQuestion) addAsked(result.nextQuestion.id);

      // P2-1：仅当有明确 answeredId 时写 recent_qa，避免 'unknown' 污染上下文
      if (lastKey) {
        const answeredQuestion = questionLoader.getQuestionById(lastKey);
        const userAnswerText = raw || value;
        await ctxStore.appendRecentQA({
          question_id: lastKey,
          question_text: answeredQuestion?.text ?? '',
          answer: userAnswerText,
          answered_at: new Date().toISOString(),
        });
        // v2.3：await 期间组件可能卸载，卸载后不再 setState
        if (!mountedRef.current) return;

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
            recentQA: ctxStore.getRecentQA(5),
            seed: engine.getSeedInput(),
            mode: engine.getMode(),
          });

          if (decision) {
            // 异步调 LLM 生成追问题（8s 超时降级）
            const followup = await generateFollowupQuestion(decision);
            // v2.3：8s 等待期间组件可能卸载，卸载后不再 setState（防止内存泄漏/React 警告）
            if (!mountedRef.current) return;
            if (followup) {
              // 插入追问题，覆盖原本的 nextQuestion
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
              return; // 不继续 finishAndGenerate
            }
          }
        }
      }

      if (result.isComplete || !result.nextQuestion) {
        // v2.3：显式 await，保证 finishAndGenerate 内部的 ctxStore 写入完成
        await finishAndGenerate();
      } else {
        setCanUndo(engine.canUndo());
      }
    },
    [setStage, setCurrentQuestion, addAsked, addIntentTag, recordAnswer, ctxStore, setCanUndo],
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
   *  注意：必须定义在 finishEarlyAndGenerate 之前，因为后者引用它
   */
  const finishAndGenerate = useCallback(async () => {
    const engine = getEngine();
    const snap = engine.snapshot();
    // v2.1：读取上下文喂给 PromptGenerator
    const recentQA = ctxStore.getRecentQA(20);
    const preferences = ctxStore.getPreferences();
    // P3：传递 mode（direct/quick/full → quick/full，direct 无需推断）
    const engineMode = engine.getMode();
    const genMode = engineMode === 'quick' ? 'quick' : 'full';
    const prompt = promptGenerator.generate({
      intentTags: snap.intentTags,
      answers: snap.answers,
      seedInput: snap.seedInput,
      project: projectFingerprint,
      recentQA,
      preferences,
      mode: genMode,
    });
    setResult(prompt);
    await ctxStore.setIntentTags(snap.intentTags);
    await ctxStore.setLastPrompt(promptGenerator.toMarkdown(prompt));
    // v2.1：累积本次提问沉淀的稳定偏好（场景/主题/响应式等）
    const newPrefs = extractPreferencesFromEngine(engine);
    if (newPrefs.length > 0) {
      await ctxStore.appendPreferences(newPrefs);
    }
    pushRecentPrompt(promptGenerator.toMarkdown(prompt));
    transition('result');
  }, [setResult, ctxStore, transition, projectFingerprint]);

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
    async (seed: string) => {
      const engine = getEngine();
      resetEngineStore();
      // 清空上下文，避免上次会话的 QA 污染本次生成
      await ctxStore.clear();
      engine.start(seed, 'direct');
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
    },
    [resetEngineStore, ctxStore, setSeedInput, setStage, addIntentTag, finishAndGenerate],
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
          { recentQA, preferences },
        );
        setResult(prompt);
        await ctxStore.setIntentTags(remaining);
        await ctxStore.setLastPrompt(promptGenerator.toMarkdown(prompt));
      }
    },
    [removeTagStore, appState, promptGenerator, setResult, ctxStore, projectFingerprint],
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
      if (appState === 'result') {
        const recentQA = ctxStore.getRecentQA(20);
        const preferences = ctxStore.getPreferences();
        const prompt = promptGenerator.generate({
          intentTags: engine.getIntentTags(),
          answers: engine.getAnswers(),
          seedInput: engine.getSeedInput(),
          project: projectFingerprint,
          recentQA,
          preferences,
        });
        setResult(prompt);
        await ctxStore.setIntentTags(engine.getIntentTags());
        await ctxStore.setLastPrompt(promptGenerator.toMarkdown(prompt));
      }
    },
    [addIntentTag, appState, promptGenerator, setResult, ctxStore, projectFingerprint],
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
