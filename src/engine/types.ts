// src/engine/types.ts
// 提问引擎核心类型定义，与架构设计 4.1/4.5 节一致

export type PromptStage = 'perceive' | 'name' | 'spec' | 'execute' | 'verify';

export type StageName = 'IDLE' | 'PERCEIVE' | 'NAME' | 'SPEC' | 'EXECUTE' | 'VERIFY' | 'COMPLETE';

/** 提问流程模式：direct=直接生成 / quick=快速提问(仅核心题) / full=详细诊断(全部题) */
export type FlowMode = 'direct' | 'quick' | 'full';

export type QuestionType = 'single-choice' | 'multi-choice' | 'open' | 'scale';

export interface QuestionOption {
  label: string;
  value: string;
  tags: string[];
}

export interface IntentExtractionRule {
  keywords: { keyword: string; extract_tag: string }[];
}

export interface JumpRule {
  when_answer: string;
  next_question_id: string;
}

export interface Question {
  id: string;
  stage: PromptStage;
  order: number;
  text: string;
  type: QuestionType;
  options: QuestionOption[];
  allow_custom: boolean;
  placeholder?: string;
  trigger_tags: string[];
  jumps: JumpRule[];
  intent_extraction?: IntentExtractionRule;
  required: boolean;
  timeout_sec?: number | null;
  // 新增：形容词簇触发（可选）。命中后本题的选题权重会得到加权。
  trigger_clusters?: string[];
  // 快速模式下是否提问此题（仅 quick_mode: true 的题会在快速模式中被选中）
  quick_mode?: boolean;
}

export interface StageMeta {
  id: PromptStage;
  name: string;
  order: number;
}

export interface QuestionBank {
  schema_version: string;
  bank_id: string;
  scene: string;
  total_questions: number;
  stages: StageMeta[];
  questions: Question[];
}

export const STAGE_ORDER: PromptStage[] = ['perceive', 'name', 'spec', 'execute', 'verify'];

export const STAGE_LABEL: Record<PromptStage, string> = {
  perceive: '感知阶段',
  name: '命名阶段',
  spec: '规格阶段',
  execute: '执行阶段',
  verify: '验证阶段',
};

export const STAGE_TO_STATE: Record<PromptStage, StageName> = {
  perceive: 'PERCEIVE',
  name: 'NAME',
  spec: 'SPEC',
  execute: 'EXECUTE',
  verify: 'VERIFY',
};

// ─────────── 形容词簇（v1：本地规则引擎升级） ───────────

/** 簇中一条 dimension tag，含权重 */
export interface ClusterTagWeight {
  tag: string;
  weight: number;
}

/** 簇的动态澄清题选项 */
export interface ClusterClarificationOption {
  label: string;
  target_tag: string;
}

/** 单个形容词簇 */
export interface AdjectiveCluster {
  id: string;
  surface_forms: string[];
  /** 多个维度标签及权重（命中本簇时这些标签会被加权） */
  dimension_tags: ClusterTagWeight[];
  /** 可选：命中本簇后若无法直接定位首问题，生成的动态澄清题文案 */
  clarification_question?: string;
  /** 可选：动态澄清题的选项 */
  clarification_options?: ClusterClarificationOption[];
  /** 可选：程度调节系数（>1 增强倾向，<1 减弱倾向），默认 1 */
  magnitude_modifier?: number;
  /** 可选：仅作为修饰词，不直接产出 dimension tag（如"太"），由其它簇补全 */
  is_modifier_only?: boolean;
}

/** 形容词簇配置整体（YAML 根） */
export interface AdjectiveClusterConfig {
  schema_version: string;
  total_clusters: number;
  clusters: AdjectiveCluster[];
}

/** 簇匹配后的命中记录 */
export interface ClusterMatch {
  cluster: AdjectiveCluster;
  /** 命中的 surface form 原文（可能含大小写差异） */
  matched_form: string;
  /** 本簇叠加的 magnitude（默认 1） */
  magnitude: number;
}

/** 标签权重聚合结果 */
export interface TagScore {
  tag: string;
  /** 累计权重（来自多个簇） */
  weight: number;
  /** 命中的簇 ID 列表 */
  source_clusters: string[];
}

/** 路由结果扩展（v1） */
export interface SeedRouteResult {
  question: Question | null;
  matchedKeywords: string[];
  /** 命中的形容词簇（v1 新增） */
  matchedClusters?: ClusterMatch[];
  /** 聚合后的标签权重排序（v1 新增） */
  tagScores?: TagScore[];
  /** 动态生成的澄清问题（如果有） */
  dynamicClarification?: Question;
}
