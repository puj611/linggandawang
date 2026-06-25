// src/types/state.ts
// 应用/窗口/引擎状态类型定义，与架构设计第 4 章一致

export type AppState = 'ball' | 'expanded' | 'question' | 'result';

export type WindowState = AppState;

export interface WindowPosition {
  x: number;
  y: number;
  screen?: string;
}

export type EngineStageName = 'IDLE' | 'PERCEIVE' | 'NAME' | 'SPEC' | 'EXECUTE' | 'VERIFY' | 'COMPLETE';

export interface EngineStateSnapshot {
  stage: EngineStageName;
  currentQuestionId: string | null;
  askedQuestionIds: string[];
  answers: Record<string, Answer>;
  consecutiveSkips: number;
  startedAt: string | null;
  seedInput: string;
}

export interface Answer {
  questionId: string;
  value: string;
  raw: string;
  tags: string[];
  skipped: boolean;
  answeredAt: string;
}
