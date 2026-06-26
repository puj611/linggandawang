// src/engine/Selector.ts
// 选题规则 v2.0：阶段过滤 + 去重 + 归一化评分 + 跳转 + 兜底
// v2.0 升级（Phase 4）：
//   - 评分从「累加式加权」改为「4 维归一化加权」
//   - 最终 score = 0.4*tagMatch + 0.3*cluster + 0.2*llmConfidence + 0.1*orderBonus
//   - 每个维度归一化到 [0,1]，避免某一项主导整体得分
//   - 新增 llmConfidence 字段：来自 LLMIntentAnalysis.detected_dimensions 的加权平均置信度
import type { Question, PromptStage, QuestionBank, TagScore } from './types';
import type { QuestionLoader } from './QuestionLoader';
import type { IntentTag } from '@/types/intent-tag';
import type { Answer } from '@/types/state';

export interface SelectorContext {
  stage: PromptStage;
  askedIds: string[];
  intentTags: IntentTag[];
  answers: Record<string, Answer>;
  lastAnswer?: Answer;
  forcedNextId?: string | null; // 来自 jump 规则
  // v1.1：种子路由聚合后的标签权重
  tagScores?: TagScore[];
  // v1.1：本次种子命中的形容词簇 ID 集合
  matchedClusterIds?: string[];
  // v1.1：是否允许选动态生成的题（默认 false）
  allowDynamicQuestion?: boolean;
  // 快速模式：仅选 quick_mode: true 的题
  quickMode?: boolean;
  // v2.0（Phase 4）：LLM 意图置信度，0-1，未配置 LLM 时由调用方传 0.5（中性）
  llmConfidence?: number;
}

// v2.0：归一化评分维度权重
const W_TAG_MATCH = 0.4;
const W_CLUSTER = 0.3;
const W_LLM_CONFIDENCE = 0.2;
const W_ORDER_BONUS = 0.1;

export class Selector {
  constructor(private loader: QuestionLoader) {}

  /** 选下一题：jump > 归一化评分 > 兜底 order */
  select(ctx: SelectorContext): Question | null {
    const bank = this.loader.getBank();
    const isQuick = !!ctx.quickMode;

    // 1. 跳转规则优先（快速模式下仅跟随指向核心题的 jump）
    if (ctx.forcedNextId) {
      const q = this.loader.getQuestionById(ctx.forcedNextId);
      if (q && !ctx.askedIds.includes(q.id) && (!isQuick || q.quick_mode)) return q;
    }

    const stageQuestions = bank.questions
      .filter((q) => q.stage === ctx.stage && !ctx.askedIds.includes(q.id) && (!isQuick || q.quick_mode))
      .sort((a, b) => a.order - b.order);

    if (stageQuestions.length === 0) return null;

    // 2. 归一化评分（4 维加权，每个维度 [0,1]）
    const tagValues = ctx.intentTags.map((t) => `${t.label}: ${t.value}`);
    const topTags = (ctx.tagScores ?? []).slice(0, 3).map((s) => s.tag);
    const matchedClusters = new Set(ctx.matchedClusterIds ?? []);
    const llmConfidence = typeof ctx.llmConfidence === 'number' ? clamp01(ctx.llmConfidence) : 0.5;

    // 计算 orderBonus 归一化用：本阶段最大 order
    const maxOrder = stageQuestions.reduce((m, q) => Math.max(m, q.order), 1);

    const scored = stageQuestions.map((q) => {
      // 维度 1：tagMatch（0-1）— trigger_tags 命中比例 + tagScores 高分加权
      const tagMatch = computeTagMatch(q, tagValues, topTags, ctx.tagScores);

      // 维度 2：cluster（0-1）— trigger_clusters 命中比例
      const cluster = computeClusterMatch(q, matchedClusters);

      // 维度 3：llmConfidence（0-1）— 直接用上下文传入的 LLM 置信度
      // 注意：所有题共享同一 llmConfidence，此维度主要用于在没有 tag/cluster 命中时区分场景
      // 当 LLM 置信度高时，更倾向于选 trigger_tags 与 LLM 检测到的 tag 一致的题（已通过 tagMatch 体现）
      // 这里作为基础分：高置信度场景下所有题都获得此基础分，避免 0 分题被无差别兜底
      const llmScore = llmConfidence;

      // 维度 4：orderBonus（0-1）— order 越小分越高，1/maxOrder ~ 1
      const orderBonus = maxOrder > 1 ? 1 - (q.order - 1) / (maxOrder - 1) : 1;

      // 最终归一化评分
      const score = W_TAG_MATCH * tagMatch + W_CLUSTER * cluster + W_LLM_CONFIDENCE * llmScore + W_ORDER_BONUS * orderBonus;

      return { q, score, tagMatch, cluster, orderBonus };
    });

    scored.sort((a, b) => b.score - a.score || a.q.order - b.q.order);

    return scored[0].q;
  }

  /** 阶段首个问题（无 trigger_tags 干扰） */
  firstOfStage(stage: PromptStage, quickMode = false): Question | null {
    const list = this.loader
      .getBank()
      .questions.filter((q) => q.stage === stage && (!quickMode || q.quick_mode))
      .sort((a, b) => a.order - b.order);
    return list[0] ?? null;
  }

  /** 判断阶段是否已完成 */
  isStageComplete(ctx: SelectorContext): boolean {
    return this.select(ctx) === null;
  }

  /** 判断 jump 规则是否命中 */
  resolveJump(lastAnswer: Answer, bank: QuestionBank): string | null {
    if (!lastAnswer) return null;
    const q = bank.questions.find((x) => x.id === lastAnswer.questionId);
    if (!q) return null;
    for (const rule of q.jumps ?? []) {
      if (rule.when_answer === lastAnswer.value) return rule.next_question_id;
    }
    return null;
  }
}

// ───────── v2.0 归一化评分辅助函数 ─────────

/** 将数值限制在 [0,1] 区间 */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * 维度 1：tagMatch（0-1）
 * 计算 trigger_tags 与用户意图标签的匹配度：
 *   - 基础命中分：trigger_tags 中有多少被用户标签命中（命中数 / max(1, trigger_tags.length)）
 *   - tagScores 加权：top 3 高权重 tag 中命中的数量 × 平均权重，归一化到 [0,1]
 * 最终：0.6*基础命中率 + 0.4*tagScores加权（两段都归一化后加权）
 */
function computeTagMatch(
  q: Question,
  tagValues: string[],
  topTags: string[],
  tagScores?: TagScore[],
): number {
  const triggers = q.trigger_tags ?? [];
  if (triggers.length === 0) return 0;

  // 基础命中：trigger_tags 命中比例
  let hitCount = 0;
  for (const trigger of triggers) {
    if (tagValues.some((v) => v.includes(trigger) || trigger.includes(v))) {
      hitCount++;
    }
  }
  const baseRate = hitCount / triggers.length;

  // tagScores 加权：top 3 中命中的 tag 的平均权重
  let weightedScore = 0;
  if (topTags.length > 0 && tagScores) {
    let hitWeightSum = 0;
    let hitCount2 = 0;
    for (const t of topTags) {
      if (triggers.includes(t)) {
        const w = tagScores.find((s) => s.tag === t)?.weight ?? 0;
        hitWeightSum += w;
        hitCount2++;
      }
    }
    if (hitCount2 > 0) {
      // 平均权重（0-1），命中越多权重叠加越高但归一化
      weightedScore = Math.min(1, hitWeightSum / topTags.length);
    }
  }

  return clamp01(0.6 * baseRate + 0.4 * weightedScore);
}

/**
 * 维度 2：cluster（0-1）
 * trigger_clusters 命中比例（命中数 / max(1, trigger_clusters.length)）
 */
function computeClusterMatch(q: Question, matchedClusters: Set<string>): number {
  const clusters = q.trigger_clusters ?? [];
  if (clusters.length === 0) return 0;
  let hitCount = 0;
  for (const cid of clusters) {
    if (matchedClusters.has(cid)) hitCount++;
  }
  return clamp01(hitCount / clusters.length);
}
