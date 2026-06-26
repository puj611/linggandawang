// src/hooks/useFlow.ts
// 主流程编排：四态串联 + 引擎 + 生成器 + 上下文
// v2.0：start 前异步调用 LLM 意图分析，降级时回退关键词匹配
// v2.1：上下文存储回读闭环 — start 时读 recent_qa 喂给 LLM，generate 时注入 preferences + recentQA
import { useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useEngineStore } from '@/stores/engineStore';
import { useContextStore } from '@/stores/contextStore';
import { useFeatureStore } from '@/stores/featureStore';
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
  } = useEngineStore();

  const ctxStore = useContextStore();
  const features = useFeatureStore();
  const projectFingerprint = useProjectStore((s) => s.fingerprint);

  const { setCanUndo } = useEngineStore();

  /** 启动提问（v2.0：异步调用 LLM 意图分析后启动引擎）
   *  v2.1：从 contextStore 读取 recent_qa 喂给 LLM，提升分析连续性
   *  v2.2：重置本次会话的动态追问标记
   */
  const start = useCallback(
    async (seed: string, mode: FlowMode = 'full') => {
      const engine = getEngine();
      resetEngineStore();
      // v2.2：每次 start 重置追问标记
      followupTriggeredThisSession = false;

      // v2.1：从 contextStore 读取最近问答历史，喂给 LLM 提供连续性
      // 注意：不等待 load()，因为 ctxStore 通常在 App 启动时已 load
      const recentQA = ctxStore.getRecentQA(8).map((qa) => ({
        question: qa.question_text,
        answer: qa.answer,
      }));

      // v2.0：异步调用 LLM 意图分析（8 秒超时，降级返回 null）
      let llmAnalysis = null;
      try {
        const projectStack = projectFingerprint
          ? [projectFingerprint.framework, projectFingerprint.language, projectFingerprint.css_solution]
              .filter(Boolean)
              .join(' / ')
          : undefined;
        llmAnalysis = await analyzeIntent(seed, projectStack, recentQA);
      } catch (e) {
        console.warn('[useFlow] LLM 意图分析失败，降级到关键词匹配', e);
      }

      const q = engine.start(seed, mode, llmAnalysis);
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

      // 写入上下文 recent_qa
      const answeredId = lastKey ?? 'unknown';
      const answeredQuestion = questionLoader.getQuestionById(answeredId);
      const userAnswerText = raw || value;
      await ctxStore.appendRecentQA({
        question_id: answeredId,
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
          lastAnswer: allAnswers[answeredId] ?? { questionId: answeredId, value, raw, tags: optionTags, skipped: false, answeredAt: new Date().toISOString() },
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

      if (result.isComplete || !result.nextQuestion) {
        finishAndGenerate();
      } else {
        setCanUndo(engine.canUndo());
      }
    },
    [setStage, setCurrentQuestion, addAsked, addIntentTag, recordAnswer, ctxStore, setCanUndo],
  );

  /** 跳过当前题 */
  const skip = useCallback(() => {
    const engine = getEngine();
    const result = engine.skip();
    const lastAns = engine.getAnswers();
    const lastKey = Object.keys(lastAns).pop();
    if (lastKey) recordAnswer(lastAns[lastKey]);
    incSkip();
    setStage(engine.getStage());
    setCurrentQuestion(result.nextQuestion);
    if (result.nextQuestion) addAsked(result.nextQuestion.id);

    if (result.isComplete || !result.nextQuestion) {
      finishAndGenerate();
    } else if (result.needSkipConfirm) {
      openSkipConfirm();
    }
    setCanUndo(engine.canUndo());
  }, [recordAnswer, incSkip, setStage, setCurrentQuestion, addAsked, openSkipConfirm, setCanUndo]);

  /** 用户在二次确认中选择"继续提问" */
  const continueAfterSkipConfirm = useCallback(() => {
    resetSkip();
  }, [resetSkip]);

  /** 用户在二次确认中选择"结束并生成" */
  const finishEarlyAndGenerate = useCallback(() => {
    const engine = getEngine();
    engine.finishEarly();
    resetSkip();
    finishAndGenerate();
  }, [resetSkip]);

  /** 生成提示词并进入结果态
   *  v2.1：注入 recentQA + preferences 上下文，并在生成后累积用户新偏好
   */
  const finishAndGenerate = useCallback(async () => {
    const engine = getEngine();
    const snap = engine.snapshot();
    // v2.1：读取上下文喂给 PromptGenerator
    const recentQA = ctxStore.getRecentQA(20);
    const preferences = ctxStore.getPreferences();
    const prompt = promptGenerator.generate({
      intentTags: snap.intentTags,
      answers: snap.answers,
      seedInput: snap.seedInput,
      project: projectFingerprint,
      recentQA,
      preferences,
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

  /** 直接生成：跳过所有问题，仅基于种子输入+意图提取生成提示词 */
  const directGenerate = useCallback(
    async (seed: string) => {
      const engine = getEngine();
      resetEngineStore();
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
    [resetEngineStore, setSeedInput, setStage, addIntentTag, finishAndGenerate],
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

  /** 重新提问 */
  const restart = useCallback(() => {
    const engine = getEngine();
    engine.reset();
    resetEngineStore();
    transition('expanded');
  }, [resetEngineStore, transition]);

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
    features,
  };
}

// 类型导出供其他模块使用
export type { Answer, IntentTag };
