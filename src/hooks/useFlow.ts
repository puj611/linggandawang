// src/hooks/useFlow.ts
// 主流程编排：四态串联 + 引擎 + 生成器 + 上下文
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
import { useAnalyticsStore } from '@/stores/analyticsStore';
import { useProjectStore } from '@/stores/projectStore';
import { v4 as uuidv4 } from 'uuid';

// 模块级单例：所有组件共享同一 engine 实例，避免组件切换时状态丢失
let engineInstance: QuestionEngine | null = null;

function getEngine(): QuestionEngine {
  if (!engineInstance) {
    questionLoader.load();
    engineInstance = new QuestionEngine(questionLoader);
  }
  return engineInstance;
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

  /** 启动提问 */
  const start = useCallback(
    (seed: string, mode: FlowMode = 'full') => {
      const engine = getEngine();
      // 重置 engineStore，清除上一轮残留的标签/答案/结果
      resetEngineStore();
      const q = engine.start(seed, mode);
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
      setCanUndo(false); // 启动时清空 undo 标记
      // v1.1 记录簇命中分析数据
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
    [resetEngineStore, setSeedInput, setStage, setCurrentQuestion, addAsked, addIntentTag, transition],
  );

  /** 提交答案 */
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

      // 写入上下文 recent_qa — 注意：此时 engine.snapshot().current 已是下一题，
      // 需要从 allAnswers 取刚回答的那道题 ID，再从 bank 反查问题文本
      const answeredId = lastKey ?? 'unknown';
      const answeredQuestion = questionLoader.getQuestionById(answeredId);
      await ctxStore.appendRecentQA({
        question_id: answeredId,
        question_text: answeredQuestion?.text ?? '',
        answer: raw || value,
        answered_at: new Date().toISOString(),
      });

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

  /** 生成提示词并进入结果态 */
  const finishAndGenerate = useCallback(async () => {
    const engine = getEngine();
    const snap = engine.snapshot();
    const prompt = promptGenerator.generate({
      intentTags: snap.intentTags,
      answers: snap.answers,
      seedInput: snap.seedInput,
      project: projectFingerprint,
    });
    setResult(prompt);
    await ctxStore.setIntentTags(snap.intentTags);
    await ctxStore.setLastPrompt(promptGenerator.toMarkdown(prompt));
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

  /** 删除意图标签后重生成 */
  const removeTag = useCallback(
    async (id: string) => {
      removeTagStore(id);
      const engine = getEngine();
      const remaining = engine.removeIntentTag(id);
      if (appState === 'result') {
        const prompt = promptGenerator.regenerate(remaining, engine.getAnswers(), engine.getSeedInput(), projectFingerprint);
        setResult(prompt);
        await ctxStore.setIntentTags(remaining);
        await ctxStore.setLastPrompt(promptGenerator.toMarkdown(prompt));
      }
    },
    [removeTagStore, appState, promptGenerator, setResult, ctxStore, projectFingerprint],
  );

  /** 添加截图诊断产出的标签 */
  const addScreenshotTags = useCallback(
    async (tags: IntentTag[]) => {
      const engine = getEngine();
      for (const t of tags) {
        engine.addIntentTag(t);
        addIntentTag(t);
      }
      if (appState === 'result') {
        const prompt = promptGenerator.generate({
          intentTags: engine.getIntentTags(),
          answers: engine.getAnswers(),
          seedInput: engine.getSeedInput(),
          project: projectFingerprint,
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
