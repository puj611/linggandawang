// src/engine/Selector.ts
// 选题规则 v1.1：阶段过滤 + 去重 + 意图标签驱动 + 跳转 + 兜底 + 簇权重加权
// v1.1 升级：
//   - SelectorContext 新增 tagScores（v1 从 seed 路由注入）
//   - 选题时综合考虑 trigger_tags 命中 + tagScores 累计权重
//   - 当 tagScores 给出明确高分时，优先选与高权重 tag 关联的题
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
  // v1.1 新增：种子路由聚合后的标签权重
  tagScores?: TagScore[];
  // v1.1 新增：本次种子命中的形容词簇 ID 集合
  matchedClusterIds?: string[];
  // v1.1 新增：是否允许选动态生成的题（默认 false，避免与路由层重复）
  allowDynamicQuestion?: boolean;
  // 快速模式：仅选 quick_mode: true 的题
  quickMode?: boolean;
}

export class Selector {
  constructor(private loader: QuestionLoader) {}

  /** 选下一题：jump > tagScores 命中 > trigger_tags 命中 > 兜底 order */
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

    // 2. 综合评分
    const tagValues = ctx.intentTags.map((t) => `${t.label}: ${t.value}`);
    const topTags = (ctx.tagScores ?? []).slice(0, 3).map((s) => s.tag);
    const matchedClusters = new Set(ctx.matchedClusterIds ?? []);

    const scored = stageQuestions.map((q) => {
      let score = 0;
      // 2a. trigger_tags 命中（命中数 + 原始权重）
      for (const trigger of q.trigger_tags) {
        if (tagValues.some((v) => v.includes(trigger) || trigger.includes(v))) {
          score += 1;
        }
      }
      // 2b. tagScores 高分加权（v1.1）
      for (const t of topTags) {
        if (q.trigger_tags.includes(t)) {
          const weight = ctx.tagScores!.find((s) => s.tag === t)?.weight ?? 0;
          score += 1 + weight; // 基础分 1 + 累计权重
        }
      }
      // 2c. trigger_clusters 直接命中（v1.1）—— 强信号 +2.5
      if (q.trigger_clusters && q.trigger_clusters.length > 0) {
        for (const cid of q.trigger_clusters) {
          if (matchedClusters.has(cid)) {
            score += 2.5;
          }
        }
      }
      return { q, score };
    });

    scored.sort((a, b) => b.score - a.score || a.q.order - b.q.order);

    if (scored[0].score > 0) return scored[0].q;
    return scored[0].q; // 兜底：order 最小
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
