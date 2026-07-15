// src/types/requirement.ts
// 需求同步器类型定义

/** 子任务状态 */
export type SubtaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped';

/** 子任务优先级 */
export type SubtaskPriority = 'P0' | 'P1' | 'P2';

/** 子任务类型 */
export type SubtaskType = 'feature' | 'bugfix' | 'refactor' | 'test' | 'docs' | 'design';

/** 单个子任务 */
export interface Subtask {
  id: string;
  title: string;
  description: string;
  type: SubtaskType;
  status: SubtaskStatus;
  priority: SubtaskPriority;
  /** 预估工作量（小时） */
  estimated_hours: number;
  /** 实际耗时（小时） */
  actual_hours: number;
  /** 依赖的子任务 ID 列表 */
  dependencies: string[];
  /** 涉及的文件/模块路径 */
  affected_files: string[];
  /** 关联的意图标签 */
  related_tags: string[];
  /** 提示词生成建议（给 PromptGenerator 用） */
  prompt_suggestion: string;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
  /** 完成时间（仅 done 状态） */
  completed_at?: string;
}

/** 需求文档 */
export interface Requirement {
  id: string;
  title: string;
  description: string;
  /** 用户原始输入 */
  raw_input: string;
  /** 拆解后的子任务列表 */
  subtasks: Subtask[];
  /** 整体状态 */
  status: 'analyzing' | 'ready' | 'in_progress' | 'completed' | 'archived';
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
  /** 关联的项目路径 */
  project_path?: string;
  /** 关联的意图标签（来自提问引擎） */
  intent_tags: Array<{ label: string; value: string }>;
}

/** 需求拆解 LLM 输出（raw JSON） */
export interface RequirementDecomposition {
  title: string;
  summary: string;
  subtasks: Array<{
    title: string;
    description: string;
    type: SubtaskType;
    priority: SubtaskPriority;
    estimated_hours: number;
    dependencies: number[];
    affected_files: string[];
    prompt_suggestion: string;
  }>;
}

/** 需求同步面板筛选条件 */
export interface RequirementFilter {
  status?: SubtaskStatus | 'all';
  priority?: SubtaskPriority | 'all';
  type?: SubtaskType | 'all';
  search?: string;
}
