// src/types/prompt.ts
// 提示词四段结构类型，与架构设计 4.3 节一致

import type { IntentTag } from './intent-tag';
import type { ProjectFingerprint } from './project';

export interface PromptSegment {
  title: string;
  content: string;
  raw_quote?: string;
}

export interface PromptResult {
  project_context: PromptSegment | null;
  action: PromptSegment;
  spec: PromptSegment;
  constraint: PromptSegment;
  verify: PromptSegment;
  raw_quotes: string[];
  intent_tags: IntentTag[];
  generated_at: string;
  project?: ProjectFingerprint;
}

export interface MarkdownExportOptions {
  include_raw_quotes: boolean;
  include_tags: boolean;
  code_block_for_spec: boolean;
  include_project_context: boolean;
}
