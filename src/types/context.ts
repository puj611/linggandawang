// src/types/context.ts
// context.json schema 类型，与架构设计 4.2 节一致

import type { IntentTag } from './intent-tag';

export interface DevProgress {
  current_milestone?: string;
  current_task_id?: string;
  current_task_status?: 'todo' | 'in_progress' | 'blocked' | 'done';
  blocked_reason?: string;
  last_tool?: 'trae' | 'claude-code' | 'workbuddy' | 'manual';
  notes?: string;
}

export interface ContextProject {
  name?: string;
  path?: string;
  type?: 'frontend' | 'backend' | 'fullstack' | 'other';
}

export interface ContextPreference {
  key: string;
  value: string;
  confirmed_at: string;
}

export interface ContextRecentQA {
  question_id: string;
  question_text: string;
  answer: string;
  answered_at: string;
}

export interface ContextTimestamps {
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface LinggandawangContext {
  schema_version: '1.0';
  project?: ContextProject;
  current_pain_point?: string;
  preferences?: ContextPreference[];
  recent_qa?: ContextRecentQA[];
  intent_tags?: IntentTag[];
  last_prompt?: string;
  dev_progress?: DevProgress;
  timestamps: ContextTimestamps;
  archived?: boolean;
}
