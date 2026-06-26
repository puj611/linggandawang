// src/engine/SmartFollowup.ts
// 动态追问引擎：在用户回答某题后，根据触发条件决定是否生成一道 LLM 追问题
// 触发条件：
//   1. high-ambiguity: LLM analysis.ambiguity_score > 0.6 且当前在 perceive 阶段
//   2. consecutive-custom: 连续 2 次用户选择"自定义输入"而非选项
//   3. stage-transition-with-skip: 阶段切换且本阶段至少一题被跳过

import { v4 as uuidv4 } from 'uuid';
import { getAdapter } from '@/lib/llm';
import type { LLMResponse } from '@/lib/llm/types';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import {
  buildFollowupMessages,
  type FollowupTrigger,
  type FollowupPromptInput,
  type FollowupLLMOutput,
} from './prompts/followup';
import type { Question, PromptStage } from './types';
import type { LLMIntentAnalysis } from './LLMIntentAnalyzer';
import type { Answer } from '@/types/state';
import type { ContextRecentQA } from '@/types/context';

const TIMEOUT_MS = 8000;

/** 触发决策（评估通过后返回，调用方据此调 LLM 生成 Question） */
export interface FollowupDecision {
  trigger: FollowupTrigger;
  reason: string; // 触发原因（中文，用于 analytics / 调试）
  promptInput: FollowupPromptInput;
}

/** 触发评估所需上下文 */
export interface FollowupEvalContext {
  /** 本次 start 的 LLM 意图分析结果（null 表示未用 LLM） */
  llmAnalysis: LLMIntentAnalysis | null;
  /** 用户刚提交的回答 */
  lastAnswer: Answer;
  /** 用户刚回答的题 */
  lastQuestion: Question;
  /** 引擎计算的下一题（null 表示即将完成） */
  nextQuestion: Question | null;
  /** 引擎的全部 answers（用于判断本阶段是否有 skipped 题） */
  allAnswers: Record<string, Answer>;
  /** 本次 start 是否已经触发过追问（防重） */
  alreadyTriggered: boolean;
  /** 最近 QA 历史（用于 promptInput） */
  recentQA: ContextRecentQA[];
  /** 用户原始种子输入 */
  seed: string;
  /** 提问模式：direct 模式不触发追问 */
  mode: 'direct' | 'quick' | 'full';
}

/**
 * 评估是否需要触发动态追问
 * - 返回 null：不触发
 * - 返回 FollowupDecision：触发，调用方应调用 generateFollowupQuestion(decision)
 */
export function evaluateFollowup(ctx: FollowupEvalContext): FollowupDecision | null {
  // 排除条件：direct 模式 / 已触发过 / 引擎已完成（nextQuestion 为 null）
  if (ctx.mode === 'direct' || ctx.alreadyTriggered) return null;
  if (!ctx.nextQuestion) return null;

  // 触发条件 1：高歧义（仅在 perceive 阶段首题刚答完时触发）
  if (ctx.llmAnalysis && ctx.llmAnalysis.ambiguity_score > 0.6 && ctx.lastQuestion.stage === 'perceive') {
    return {
      trigger: 'high-ambiguity',
      reason: `LLM 歧义度 ${ctx.llmAnalysis.ambiguity_score.toFixed(2)} > 0.6，需澄清`,
      promptInput: {
        seed: ctx.seed,
        trigger: 'high-ambiguity',
        currentQuestionText: ctx.lastQuestion.text,
        currentStage: ctx.lastQuestion.stage,
        userAnswer: ctx.lastAnswer.raw || ctx.lastAnswer.value,
        suggestedFollowup: ctx.llmAnalysis.suggested_followup,
        followupOptions: ctx.llmAnalysis.followup_options,
        recentQA: ctx.recentQA.map((qa) => ({ question: qa.question_text, answer: qa.answer })),
      },
    };
  }

  // 触发条件 2：连续 2 次自定义输入
  const isCustom = isCustomAnswer(ctx.lastAnswer, ctx.lastQuestion);
  if (isCustom && hasPrevCustomAnswer(ctx.allAnswers, ctx.lastQuestion)) {
    return {
      trigger: 'consecutive-custom',
      reason: '用户连续 2 次选择自定义输入，已有选项未覆盖其需求',
      promptInput: {
        seed: ctx.seed,
        trigger: 'consecutive-custom',
        currentQuestionText: ctx.lastQuestion.text,
        currentStage: ctx.lastQuestion.stage,
        userAnswer: ctx.lastAnswer.raw || ctx.lastAnswer.value,
        recentQA: ctx.recentQA.map((qa) => ({ question: qa.question_text, answer: qa.answer })),
      },
    };
  }

  // 触发条件 3：阶段切换且本阶段有跳过
  if (
    ctx.nextQuestion.stage !== ctx.lastQuestion.stage &&
    hasSkippedInStage(ctx.allAnswers, ctx.lastQuestion.stage)
  ) {
    return {
      trigger: 'stage-transition-with-skip',
      reason: `阶段从 ${ctx.lastQuestion.stage} 切到 ${ctx.nextQuestion.stage}，且 ${ctx.lastQuestion.stage} 阶段有跳过的题`,
      promptInput: {
        seed: ctx.seed,
        trigger: 'stage-transition-with-skip',
        currentQuestionText: ctx.lastQuestion.text,
        currentStage: ctx.lastQuestion.stage,
        userAnswer: ctx.lastAnswer.raw || ctx.lastAnswer.value,
        recentQA: ctx.recentQA.map((qa) => ({ question: qa.question_text, answer: qa.answer })),
      },
    };
  }

  return null;
}

/** 判断用户回答是否为"自定义输入"（raw 不在选项 value/label 集合中且非空非跳过） */
function isCustomAnswer(answer: Answer, question: Question): boolean {
  if (answer.skipped || !answer.raw) return false;
  if (answer.raw === '__skipped__') return false;
  const optionValues = new Set(question.options.map((o) => o.value));
  const optionLabels = new Set(question.options.map((o) => o.label));
  return !optionValues.has(answer.raw) && !optionLabels.has(answer.raw);
}

/** 判断本阶段在 lastQuestion 之前的回答是否也自定义（宽松判定：同阶段有其他非跳过回答即视为连续） */
function hasPrevCustomAnswer(
  allAnswers: Record<string, Answer>,
  currentQuestion: Question,
): boolean {
  const stagePrefix: Record<PromptStage, string> = {
    perceive: 'p',
    name: 'n',
    spec: 's',
    execute: 'e',
    verify: 'v',
  };
  const prefix = stagePrefix[currentQuestion.stage];
  // 同阶段、不同 questionId、非跳过、有 raw 内容
  const sameStageAnswers = Object.entries(allAnswers).filter(
    ([qid, a]) =>
      qid.charAt(0) === prefix &&
      qid !== currentQuestion.id &&
      !a.skipped &&
      a.raw &&
      a.raw !== '__skipped__',
  );
  return sameStageAnswers.length > 0;
}

/** 判断某阶段是否有 skipped 题 */
function hasSkippedInStage(
  allAnswers: Record<string, Answer>,
  stage: PromptStage,
): boolean {
  const stagePrefix: Record<PromptStage, string> = {
    perceive: 'p',
    name: 'n',
    spec: 's',
    execute: 'e',
    verify: 'v',
  };
  const prefix = stagePrefix[stage];
  return Object.entries(allAnswers).some(
    ([qid, a]) => qid.charAt(0) === prefix && a.skipped,
  );
}

/**
 * 调用 LLM 生成追问题（异步，8s 超时降级）
 * - 成功：返回构造好的 Question 对象（id 为 dyn-followup-xxx）
 * - 失败/超时/未配置：返回 null，调用方应继续原 nextQuestion 流程
 */
export async function generateFollowupQuestion(
  decision: FollowupDecision,
): Promise<{ question: Question; reason: string } | null> {
  const { config, hasApiKey } = useApiKeyStore.getState();
  if (!config || !hasApiKey) return null;

  const apiKey = await useApiKeyStore.getState().getApiKey();
  if (!apiKey) return null;

  const adapter = getAdapter(config.provider);
  const messages = buildFollowupMessages(decision.promptInput);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response: LLMResponse = await adapter.chat(
      {
        messages,
        model: config.model,
        temperature: 0.4, // 略高于意图分析以保证追问多样性
        max_tokens: 500,
      },
      apiKey,
      config.baseUrl,
    );

    clearTimeout(timeout);

    const output = parseFollowupResponse(response.content);
    if (!output) return null;

    // 构造 Question 对象
    const stage: PromptStage = (decision.promptInput.currentStage as PromptStage) ?? 'perceive';
    const question: Question = {
      id: `dyn-followup-${uuidv4()}`,
      stage,
      order: 999, // 动态题排在最后
      text: output.question_text,
      type: 'single-choice',
      options: output.options.map((o) => ({
        label: o.label,
        value: o.target_tag, // 用 target_tag 作为 value，便于后续标签提取
        tags: [o.target_tag],
      })),
      allow_custom: output.allow_custom,
      placeholder: output.placeholder,
      trigger_tags: [],
      jumps: [],
      required: false, // 追问题默认非必答
      why: output.why,
    };

    console.info('[SmartFollowup] 动态追问生成成功', {
      trigger: decision.trigger,
      question_text: question.text,
      options_count: question.options.length,
    });

    return { question, reason: decision.reason };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[SmartFollowup] LLM 生成追问失败，跳过', msg);
    return null;
  }
}

/** 解析 LLM 返回的 JSON，容错处理 */
function parseFollowupResponse(content: string): FollowupLLMOutput | null {
  let jsonStr = content.trim();

  // 去除可能的 markdown 代码块包裹
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const tryParse = (s: string): FollowupLLMOutput | null => {
    try {
      const raw = JSON.parse(s);
      return normalizeOutput(raw);
    } catch {
      return null;
    }
  };

  // 直接解析
  let result = tryParse(jsonStr);
  if (result) return result;

  // 尝试提取 JSON 片段
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    result = tryParse(match[0]);
    if (result) return result;
  }

  return null;
}

/** 规范化 LLM 输出 */
function normalizeOutput(raw: any): FollowupLLMOutput | null {
  if (!raw || typeof raw !== 'object') return null;

  const question_text = String(raw.question_text ?? '').trim();
  if (!question_text) return null;

  const why = String(raw.why ?? '').trim() || '基于上下文动态生成';

  const options = Array.isArray(raw.options)
    ? raw.options
        .filter((o: any) => o && typeof o === 'object')
        .slice(0, 5)
        .map((o: any) => ({
          label: String(o.label ?? '').trim(),
          target_tag: String(o.target_tag ?? '').trim(),
        }))
        .filter((o: any) => o.label && o.target_tag)
    : [];

  if (options.length < 2) return null; // 至少 2 个选项

  const allow_custom = raw.allow_custom !== false; // 默认 true
  const placeholder = raw.placeholder ? String(raw.placeholder) : undefined;

  return { question_text, why, options, allow_custom, placeholder };
}
