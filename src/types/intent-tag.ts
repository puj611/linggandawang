// src/types/intent-tag.ts
// 意图标签类型，与架构设计 4.4 节一致

export type PromptStage = 'perceive' | 'name' | 'spec' | 'execute' | 'verify';

export type IntentTagSource =
  | 'option'
  | 'custom-input'
  | 'extracted-keyword'
  | 'screenshot-diagnosis';

export interface IntentTag {
  id: string;
  label: string;
  value: string;
  stage: PromptStage;
  source_question_id: string;
  source_type: IntentTagSource;
  confidence: number;
  deletable: boolean;
  created_at: string;
}

export interface IntentTagChip {
  id: string;
  display_text: string;
  color: 'purple' | 'yellow';
  deletable: boolean;
}
