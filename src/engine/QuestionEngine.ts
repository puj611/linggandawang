// src/engine/QuestionEngine.ts
// 提问引擎状态机：IDLE → PERCEIVE → NAME → SPEC → EXECUTE → VERIFY → COMPLETE
import type { Question, StageName, PromptStage, QuestionBank, FlowMode } from './types';
import { STAGE_ORDER, STAGE_TO_STATE } from './types';
import type { QuestionLoader } from './QuestionLoader';
import { Selector } from './Selector';
import { routeSeedWithClusters, pickFirstQuestionByTagScores, routeWithLLMAnalysis } from './seedRouter';
import type { TagScore, ClusterMatch } from './types';
import type { IntentTag } from '@/types/intent-tag';
import type { Answer } from '@/types/state';
import type { LLMIntentAnalysis } from './LLMIntentAnalyzer';
import { analysisToIntentTags } from './LLMIntentAnalyzer';
import { v4 as uuidv4 } from 'uuid';

export interface EngineSnapshot {
  stage: StageName;
  current: Question | null;
  askedIds: string[];
  answers: Record<string, Answer>;
  intentTags: IntentTag[];
  consecutiveSkips: number;
  seedInput: string;
  startedAt: string | null;
  isComplete: boolean;
}

export interface AnswerResult {
  nextQuestion: Question | null;
  isStageAdvanced: boolean;
  isComplete: boolean;
  needSkipConfirm: boolean;
  extractedTags: IntentTag[];
}

const STAGE_SEQUENCE: PromptStage[] = STAGE_ORDER;

export class QuestionEngine {
  private stage: StageName = 'IDLE';
  private current: Question | null = null;
  private askedIds: string[] = [];
  private answers: Record<string, Answer> = {};
  private intentTags: IntentTag[] = [];
  private consecutiveSkips = 0;
  private seedInput = '';
  private startedAt: string | null = null;
  private forcedNextId: string | null = null;
  private selector: Selector;
  // v1.1 新增：种子路由聚合后的标签权重，供 selectNext 使用
  private tagScores: TagScore[] = [];
  // v1.1 新增：本次种子命中的形容词簇 ID 集合，供 selectNext 加权 trigger_clusters
  private matchedClusterIds: string[] = [];
  // v1.1 新增：本次种子命中的簇完整信息（用于 analytics）
  private matchedClusters: ClusterMatch[] = [];
  // v1.1 新增：本次种子命中的关键词（来自 keyword routes）
  private matchedKeywords: string[] = [];
  // v1.1 新增：是否生成了动态澄清题
  private hasDynamicClarification = false;
  // v1.1 新增：路由来源：'keyword' | 'cluster' | 'fallback'
  private routeSource: 'keyword' | 'cluster' | 'fallback' | 'llm' = 'fallback';
  // 提问模式：direct=直接生成 / quick=快速提问 / full=详细诊断
  private mode: FlowMode = 'full';
  // v1.2 新增：历史栈，每条记录一次「当前题 + 阶段 + askedIds 快照 + 标签 + answers 快照」
  private history: Array<{
    current: Question | null;
    stage: StageName;
    askedIds: string[];
    answers: Record<string, Answer>;
    intentTags: IntentTag[];
    consecutiveSkips: number;
  }> = [];

  constructor(private loader: QuestionLoader) {
    this.selector = new Selector(loader);
  }

  getBank(): QuestionBank {
    return this.loader.getBank();
  }

  /** v2.0 新增：LLM 意图分析结果（本次 start 时传入，通过 getLLMAnalysis 暴露给后续阶段使用） */
  private _llmAnalysis: LLMIntentAnalysis | null = null;

  /** 启动提问：路由 seed 到首问题。mode 控制提问深度 */
  start(seed: string, mode: FlowMode = 'full', llmAnalysis?: LLMIntentAnalysis | null): Question | null {
    this.reset();
    this.mode = mode;
    this.seedInput = seed;
    this.startedAt = new Date().toISOString();
    this.stage = 'PERCEIVE';
    this._llmAnalysis = llmAnalysis ?? null;

    // v2.0：LLM 分析可用时，用 LLM 结果替代关键词提取 + 形容词簇路由
    let routed: ReturnType<typeof routeSeedWithClusters>;
    if (llmAnalysis) {
      // LLM 分析可用：用 LLM 结果生成意图标签
      const llmTags = analysisToIntentTags(llmAnalysis);
      for (const t of llmTags) {
        this.intentTags.push({
          id: uuidv4(),
          label: t.label,
          value: t.value,
          stage: 'perceive',
          source_question_id: 'llm-analysis',
          source_type: 'extracted-keyword',
          confidence: 0.9,
          deletable: true,
          created_at: new Date().toISOString(),
        });
      }
      routed = routeWithLLMAnalysis(this.loader, seed, llmAnalysis);
      this.routeSource = 'llm';
    } else {
      // 降级：使用原有 seed 关键词提取 + 形容词簇路由
      this.extractFromSeed(seed);
      routed = routeSeedWithClusters(this.loader, seed);
      const isKeywordHit =
        routed.matchedKeywords.length > 0 &&
        !routed.question?.id.startsWith('dyn-clarify-') &&
        !routed.question?.id.startsWith('dyn-llm-');
      this.routeSource = isKeywordHit ? 'keyword' : this.matchedClusterIds.length > 0 ? 'cluster' : 'fallback';
    }

    this.tagScores = routed.tagScores ?? [];
    this.matchedClusters = routed.matchedClusters ?? [];
    this.matchedClusterIds = this.matchedClusters.map((m) => m.cluster.id);
    this.matchedKeywords = routed.matchedKeywords ?? [];
    this.hasDynamicClarification = !!routed.dynamicClarification;

    // direct 模式：提取意图标签后直接完成，不问任何问题
    if (mode === 'direct') {
      this.stage = 'COMPLETE';
      this.current = null;
      return null;
    }

    const isQuick = mode === 'quick';

    if (routed.question) {
      // quick 模式：仅使用核心题作为首题，非核心题回退到 p-001
      if (isQuick && !routed.question.quick_mode) {
        this.current = this.selector.firstOfStage('perceive', true) ?? routed.question;
      } else {
        this.current = routed.question;
      }
      this.stage = STAGE_TO_STATE[this.current.stage];
    } else {
      const first = pickFirstQuestionByTagScores(
        this.loader,
        this.tagScores,
        routed.matchedClusters ?? [],
      );
      if (first && (!isQuick || first.quick_mode)) {
        this.current = first;
        this.stage = STAGE_TO_STATE[first.stage];
      } else {
        this.current = this.selector.firstOfStage('perceive', isQuick);
      }
    }
    if (this.current) {
      this.askedIds = [this.current.id];
    }
    return this.current;
  }

  /** 提交当前题回答 */
  answer(value: string, raw?: string, optionTags?: string[]): AnswerResult {
    if (!this.current) {
      throw new Error('[QuestionEngine] 当前无问题，无法 answer');
    }
    // v1.2：在回答前保存历史快照（用于 undo）
    this.pushHistory();
    const q = this.current;
    const answer: Answer = {
      questionId: q.id,
      value,
      raw: raw ?? value,
      tags: optionTags ?? [],
      skipped: false,
      answeredAt: new Date().toISOString(),
    };
    this.answers[q.id] = answer;
    this.consecutiveSkips = 0;

    // 1. 选项 tags → 意图标签
    const extractedTags: IntentTag[] = [];
    for (const tag of answer.tags) {
      extractedTags.push(this.makeTag(tag, q, 'option'));
    }
    // 2. 自定义输入的关键词提取
    if (raw && q.intent_extraction?.keywords) {
      for (const rule of q.intent_extraction.keywords) {
        if (raw.toLowerCase().includes(rule.keyword.toLowerCase())) {
          extractedTags.push(this.makeTag(rule.extract_tag, q, 'extracted-keyword'));
        }
      }
    }
    this.intentTags.push(...extractedTags);

    // 3. 解析跳转规则
    this.forcedNextId = this.selector.resolveJump(answer, this.loader.getBank());

    // 4. 选下一题（先看本阶段）
    const next = this.selectNext();
    const isComplete = next === null && this.stage === 'COMPLETE';

    return {
      nextQuestion: next,
      isStageAdvanced: next !== null && next.stage !== q.stage,
      isComplete,
      needSkipConfirm: false,
      extractedTags,
    };
  }

  /** 跳过当前题 */
  skip(): AnswerResult {
    if (!this.current) {
      throw new Error('[QuestionEngine] 当前无问题，无法 skip');
    }
    // v1.2：在跳过前保存历史快照（用于 undo）
    this.pushHistory();
    const q = this.current;
    this.answers[q.id] = {
      questionId: q.id,
      value: '__skipped__',
      raw: '',
      tags: [],
      skipped: true,
      answeredAt: new Date().toISOString(),
    };
    this.consecutiveSkips += 1;
    this.forcedNextId = null;

    const next = this.selectNext();
    const needConfirm = this.consecutiveSkips >= 2 && next !== null;
    const isComplete = next === null && this.stage === 'COMPLETE';

    return {
      nextQuestion: next,
      isStageAdvanced: next !== null && next.stage !== q.stage,
      isComplete,
      needSkipConfirm: needConfirm,
      extractedTags: [],
    };
  }

  /** 用户在连续跳过二次确认中选择"结束并生成" */
  finishEarly(): void {
    this.stage = 'COMPLETE';
    this.current = null;
  }

  /** v1.2 新增：撤销上一次回答，恢复到上一题的状态 */
  undoLastAnswer(): { current: Question | null; stage: StageName; restored: boolean } {
    if (this.history.length === 0) {
      return { current: this.current, stage: this.stage, restored: false };
    }
    const snapshot = this.history.pop()!;
    this.current = snapshot.current;
    this.stage = snapshot.stage;
    this.askedIds = [...snapshot.askedIds];
    this.answers = { ...snapshot.answers };
    this.intentTags = [...snapshot.intentTags];
    this.consecutiveSkips = snapshot.consecutiveSkips;
    this.forcedNextId = null;
    return { current: this.current, stage: this.stage, restored: true };
  }

  /** v1.2 新增：重新生成本题（清掉当前题回答，从同阶段重选）
   *  实现：撤销一次回答，相当于「重新回答上一题」
   */
  regenerateCurrent(): { current: Question | null; stage: StageName; restored: boolean } {
    return this.undoLastAnswer();
  }

  /** v2.1 新增：插入一道动态追问题（来自 SmartFollowup）
   *  - 把 q 设为 current，加入 askedIds
   *  - 不调用 pushHistory（追问题本身不需要单独 undo 快照，撤销会回到追问前的状态）
   *  - 不修改 forcedNextId（追问题答完后正常走 selectNext）
   *  - 返回插入后的 current
   *  注意：调用方需先把原本的 nextQuestion 保存好（如果有的话），避免丢失
   *       推荐的调用时机：useFlow.answer 后，nextQuestion 已存到 current；此时插入 q 覆盖 current
   */
  insertFollowup(q: Question): Question {
    this.current = q;
    this.askedIds.push(q.id);
    this.stage = STAGE_TO_STATE[q.stage] ?? this.stage;
    this.forcedNextId = null;
    return q;
  }

  /** v1.2 新增：历史栈是否可撤销 */
  canUndo(): boolean {
    return this.history.length > 0;
  }

  /** v1.2 新增：保存当前状态快照到历史栈（在每次 answer/skip 之前调用） */
  private pushHistory(): void {
    if (this.history.length >= 20) {
      // 限制历史栈大小，避免内存膨胀
      this.history.shift();
    }
    this.history.push({
      current: this.current,
      stage: this.stage,
      askedIds: [...this.askedIds],
      answers: { ...this.answers },
      intentTags: [...this.intentTags],
      consecutiveSkips: this.consecutiveSkips,
    });
  }

  /** 选下一题（跨阶段推进） */
  private selectNext(): Question | null {
    const curStage = this.current!.stage;
    const curIdx = STAGE_SEQUENCE.indexOf(curStage);
    const isQuick = this.mode === 'quick';

    // v2.0（Phase 4）：从 LLMIntentAnalysis 聚合 llmConfidence
    // 取 detected_dimensions 的加权平均 confidence（权重为各 dimension 的 weight）
    // 无 LLM 分析时传 0.5（中性），让 tagMatch 和 cluster 主导评分
    const llmConfidence = this.computeLLMConfidence();

    // 同阶段选下一题
    const sameStageNext = this.selector.select({
      stage: curStage,
      askedIds: this.askedIds,
      intentTags: this.intentTags,
      answers: this.answers,
      forcedNextId: this.forcedNextId,
      tagScores: this.tagScores, // v1.1：注入聚合后的标签权重
      matchedClusterIds: this.matchedClusterIds, // v1.1：注入种子命中的簇 ID
      quickMode: isQuick, // 快速模式过滤
      llmConfidence, // v2.0：注入 LLM 置信度
    });
    if (sameStageNext) {
      this.current = sameStageNext;
      this.askedIds.push(sameStageNext.id);
      this.stage = STAGE_TO_STATE[sameStageNext.stage];
      this.forcedNextId = null;
      return sameStageNext;
    }

    // 推进到下一阶段
    for (let i = curIdx + 1; i < STAGE_SEQUENCE.length; i++) {
      const nextStage = STAGE_SEQUENCE[i];
      const q = this.selector.firstOfStage(nextStage, isQuick);
      if (q) {
        this.current = q;
        this.askedIds.push(q.id);
        this.stage = STAGE_TO_STATE[nextStage];
        this.forcedNextId = null;
        return q;
      }
    }

    // 全部完成
    this.stage = 'COMPLETE';
    this.current = null;
    return null;
  }

  isComplete(): boolean {
    return this.stage === 'COMPLETE';
  }

  currentQuestion(): Question | null {
    return this.current;
  }

  getStage(): StageName {
    return this.stage;
  }

  getIntentTags(): IntentTag[] {
    return [...this.intentTags];
  }

  removeIntentTag(id: string): IntentTag[] {
    this.intentTags = this.intentTags.filter((t) => t.id !== id);
    return this.getIntentTags();
  }

  addIntentTag(tag: IntentTag): void {
    this.intentTags.push(tag);
  }

  getAnswers(): Record<string, Answer> {
    return { ...this.answers };
  }

  getSeedInput(): string {
    return this.seedInput;
  }

  /** v1.1：获取聚合后的标签权重（供 analytics / UI 展示） */
  getTagScores(): TagScore[] {
    return [...this.tagScores];
  }

  /** v1.1：获取命中的形容词簇 ID 列表 */
  getMatchedClusterIds(): string[] {
    return [...this.matchedClusterIds];
  }

  /** v1.1：获取命中的形容词簇（含 surface_form 和 magnitude） */
  getMatchedClusters(): ClusterMatch[] {
    return [...this.matchedClusters];
  }

  /** v1.1：获取命中的关键词 */
  getMatchedKeywords(): string[] {
    return [...this.matchedKeywords];
  }

  /** v1.1：是否命中了动态澄清题 */
  getHasDynamicClarification(): boolean {
    return this.hasDynamicClarification;
  }

  /** v1.1：路由来源 */
  getRouteSource(): 'keyword' | 'cluster' | 'fallback' | 'llm' {
    return this.routeSource;
  }

  /** v2.0 新增：获取本次 start 的 LLM 意图分析结果（null 表示未使用 LLM） */
  getLLMAnalysis(): LLMIntentAnalysis | null {
    return this._llmAnalysis;
  }

  /**
   * v2.0（Phase 4）新增：从 LLMIntentAnalysis 聚合 LLM 置信度
   * - 无 LLM 分析：返回 0.5（中性，让 tagMatch/cluster 主导）
   * - 有 LLM 分析：取 detected_dimensions 的加权平均 confidence（权重为各 dimension 的 weight）
   *   若 weight 之和为 0（异常情况），退化为简单平均
   * - 结果归一化到 [0,1]
   */
  private computeLLMConfidence(): number {
    if (!this._llmAnalysis || !this._llmAnalysis.detected_dimensions.length) return 0.5;
    const dims = this._llmAnalysis.detected_dimensions;
    let weightSum = 0;
    let weightedConf = 0;
    for (const d of dims) {
      weightSum += d.weight;
      weightedConf += d.weight * d.confidence;
    }
    if (weightSum <= 0) {
      // 退化为简单平均
      const sum = dims.reduce((s, d) => s + d.confidence, 0);
      return Math.min(1, Math.max(0, sum / dims.length));
    }
    return Math.min(1, Math.max(0, weightedConf / weightSum));
  }

  /** 当前提问模式 */
  getMode(): FlowMode {
    return this.mode;
  }

  snapshot(): EngineSnapshot {
    return {
      stage: this.stage,
      current: this.current,
      askedIds: [...this.askedIds],
      answers: { ...this.answers },
      intentTags: [...this.intentTags],
      consecutiveSkips: this.consecutiveSkips,
      seedInput: this.seedInput,
      startedAt: this.startedAt,
      isComplete: this.isComplete(),
    };
  }

  reset(): void {
    this.stage = 'IDLE';
    this.current = null;
    this.askedIds = [];
    this.answers = {};
    this.intentTags = [];
    this.consecutiveSkips = 0;
    this.seedInput = '';
    this.startedAt = null;
    this.forcedNextId = null;
    this.tagScores = []; // v1.1
    this.matchedClusterIds = []; // v1.1
    this.matchedClusters = []; // v1.1
    this.matchedKeywords = []; // v1.1
    this.hasDynamicClarification = false; // v1.1
    this.routeSource = 'fallback'; // v1.1
    this.mode = 'full';
    this.history = []; // v1.2
  }

  private extractFromSeed(seed: string) {
    if (!seed) return;
    // 复用 p-001 的 intent_extraction 规则做种子关键词提取
    const p001 = this.loader.getQuestionById('p-001');
    if (!p001?.intent_extraction?.keywords) return;
    for (const rule of p001.intent_extraction.keywords) {
      if (seed.toLowerCase().includes(rule.keyword.toLowerCase())) {
        this.intentTags.push(
          this.makeTag(rule.extract_tag, p001, 'extracted-keyword'),
        );
      }
    }
  }

  private makeTag(tagStr: string, q: Question, sourceType: IntentTag['source_type']): IntentTag {
    const [label, value] = tagStr.split(':').map((s) => s.trim());
    return {
      id: uuidv4(),
      label: label || '标签',
      value: value || tagStr,
      stage: q.stage,
      source_question_id: q.id,
      source_type: sourceType,
      confidence: sourceType === 'option' ? 1 : 0.8,
      deletable: true,
      created_at: new Date().toISOString(),
    };
  }
}
