// src/stores/engineStore.ts
// 提问引擎运行时状态镜像（用于 UI 渲染），核心逻辑在 QuestionEngine 实例
import { create } from 'zustand';
import type { IntentTag } from '@/types/intent-tag';
import type { Question, StageName } from '@/engine/types';
import type { PromptResult } from '@/types/prompt';
import type { Answer } from '@/types/state';

interface EngineStore {
  stage: StageName;
  currentQuestion: Question | null;
  askedIds: string[];
  answers: Record<string, Answer>;
  intentTags: IntentTag[];
  seedInput: string;
  consecutiveSkips: number;
  result: PromptResult | null;
  startedAt: string | null;
  isProcessing: boolean;
  canUndo: boolean;
  /** Task 11：历史推荐选项（questionId → 推荐选项 value 数组），由 PreferenceLearner 基于 recent_qa + preferences 计算 */
  recommendations: Record<string, string[]>;
  setStage: (s: StageName) => void;
  setCurrentQuestion: (q: Question | null) => void;
  addAsked: (id: string) => void;
  popAsked: () => void;
  recordAnswer: (a: Answer) => void;
  removeAnswer: (questionId: string) => void;
  addIntentTag: (t: IntentTag) => void;
  removeIntentTag: (id: string) => void;
  clearIntentTags: () => void;
  setIntentTags: (tags: IntentTag[]) => void;
  setSeedInput: (s: string) => void;
  incSkip: () => void;
  resetSkip: () => void;
  setResult: (r: PromptResult | null) => void;
  setCanUndo: (v: boolean) => void;
  setIsProcessing: (v: boolean) => void;
  /** Task 11：按 questionId 合并写入推荐选项（与 recordAnswer 的 Record 写法保持一致） */
  setRecommendations: (questionId: string, values: string[]) => void;
  reset: () => void;
}

export const useEngineStore = create<EngineStore>((set) => ({
  stage: 'IDLE',
  currentQuestion: null,
  askedIds: [],
  answers: {},
  intentTags: [],
  seedInput: '',
  consecutiveSkips: 0,
  result: null,
  startedAt: null,
  isProcessing: false,
  canUndo: false,
  recommendations: {},
  setStage: (s) => set({ stage: s }),
  setCurrentQuestion: (q) => set({ currentQuestion: q }),
  addAsked: (id) => set((st) => ({ askedIds: [...st.askedIds, id] })),
  popAsked: () => set((st) => ({ askedIds: st.askedIds.slice(0, -1) })),
  recordAnswer: (a) =>
    set((st) => ({ answers: { ...st.answers, [a.questionId]: a } })),
  removeAnswer: (questionId) =>
    set((st) => {
      const next = { ...st.answers };
      delete next[questionId];
      return { answers: next };
    }),
  addIntentTag: (t) => set((st) => ({ intentTags: [...st.intentTags, t] })),
  removeIntentTag: (id) => set((st) => ({ intentTags: st.intentTags.filter((t) => t.id !== id) })),
  clearIntentTags: () => set({ intentTags: [] }),
  setIntentTags: (tags) => set({ intentTags: tags }),
  setSeedInput: (s) => set({ seedInput: s }),
  incSkip: () => set((st) => ({ consecutiveSkips: st.consecutiveSkips + 1 })),
  resetSkip: () => set({ consecutiveSkips: 0 }),
  setResult: (r) => set({ result: r }),
  setCanUndo: (v) => set({ canUndo: v }),
  setIsProcessing: (v) => set({ isProcessing: v }),
  setRecommendations: (questionId, values) =>
    set((st) => ({ recommendations: { ...st.recommendations, [questionId]: values } })),
  reset: () =>
    set({
      stage: 'IDLE',
      currentQuestion: null,
      askedIds: [],
      answers: {},
      intentTags: [],
      seedInput: '',
      consecutiveSkips: 0,
      result: null,
      startedAt: null,
      isProcessing: false,
      canUndo: false,
      recommendations: {},
    }),
}));
