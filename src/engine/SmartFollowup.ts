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
import { useLLMAvailabilityStore } from '@/stores/llmAvailabilityStore';
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
const LOCAL_TIMEOUT_MS = 20000; // Phase B：本地模型追问超时 20 秒

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
  /** 提问模式：direct/quick 模式不触发追问 */
  mode: 'direct' | 'quick' | 'full';
}

/**
 * 评估是否需要触发动态追问
 * - 返回 null：不触发
 * - 返回 FollowupDecision：触发，调用方应调用 generateFollowupQuestion(decision)
 */
export function evaluateFollowup(ctx: FollowupEvalContext): FollowupDecision | null {
  // 排除条件：direct 模式 / quick 模式 / 已触发过 / 引擎已完成（nextQuestion 为 null）
  // P2 优化：quick 模式目标是快速出结果，动态追问会插入计划外问题，与"快速"目标冲突
  if (ctx.mode === 'direct' || ctx.mode === 'quick' || ctx.alreadyTriggered) return null;
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
 * - 失败/超时/未配置：尝试规则兜底追问（r2增强），仍失败返回 null
 */
export async function generateFollowupQuestion(
  decision: FollowupDecision,
): Promise<{ question: Question; reason: string } | null> {
  const { config, hasApiKey } = useApiKeyStore.getState();

  // r2增强：未配置 LLM 时直接走规则兜底
  if (!config || !hasApiKey) {
    return generateRuleBasedFollowup(decision);
  }

  // r5增强：熔断器检查，熔断期间直接走规则兜底
  if (!useLLMAvailabilityStore.getState().shouldAttempt()) {
    console.info('[SmartFollowup] 熔断中，直接走规则兜底');
    return generateRuleBasedFollowup(decision);
  }

  const apiKey = await useApiKeyStore.getState().getApiKey();
  if (!apiKey) {
    return generateRuleBasedFollowup(decision);
  }

  const adapter = getAdapter(config.provider);
  const messages = buildFollowupMessages(decision.promptInput);

  // Phase B：本地模型用更长超时
  const isLocal = config.provider === 'local';
  const timeoutMs = isLocal ? LOCAL_TIMEOUT_MS : TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response: LLMResponse = await adapter.chat(
      {
        messages,
        model: config.model,
        temperature: 0.4, // 略高于意图分析以保证追问多样性
        max_tokens: 500,
      },
      apiKey,
      config.baseUrl,
      controller.signal, // 传入外部 signal，使 8s 超时实际生效
    );

    clearTimeout(timeout);

    const output = parseFollowupResponse(response.content);
    if (!output) {
      // r2增强：LLM 返回无法解析时走规则兜底
      return generateRuleBasedFollowup(decision);
    }

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

    // r5增强：调用成功，重置熔断器
    useLLMAvailabilityStore.getState().recordSuccess();
    return { question, reason: decision.reason };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[SmartFollowup] LLM 生成追问失败，尝试规则兜底', msg);
    // r5增强：记录失败，达阈值会触发熔断
    useLLMAvailabilityStore.getState().recordFailure(e);
    // r2增强：LLM 失败时走规则兜底，而不是直接返回 null
    return generateRuleBasedFollowup(decision);
  }
}

// =============== r2增强：规则追问兜底 ===============

/**
 * 规则追问模板（按 trigger + stage 索引）
 * 每个模板包含：题干、选项（带 target_tag）、why 说明
 */
interface RuleFollowupTemplate {
  text: string;
  why: string;
  options: { label: string; target_tag: string }[];
  placeholder?: string;
}

const RULE_FOLLOWUP_TEMPLATES: Record<string, RuleFollowupTemplate> = {
  // 连续自定义输入 → 追问具体需求
  'consecutive-custom::perceive': {
    text: '你刚才两次用自己的话描述，能再具体一点吗？比如哪个数值、哪种效果？',
    why: '连续自定义输入说明已有选项未覆盖你的需求，追问具体细节有助于精准生成',
    options: [
      { label: '具体数值（如 16px、24px）', target_tag: '具体数值' },
      { label: '具体效果（如悬浮、渐变）', target_tag: '具体效果' },
      { label: '具体场景（如移动端、暗色模式）', target_tag: '具体场景' },
    ],
    placeholder: '或自己描述具体细节...',
  },
  'consecutive-custom::name': {
    text: '你刚才的描述我没完全跟上，能具体说说是哪种风格/方向吗？',
    why: '连续自定义输入说明已有选项未覆盖你的需求，追问具体方向有助于精准生成',
    options: [
      { label: '偏现代/科技感', target_tag: '现代科技' },
      { label: '偏温馨/亲和', target_tag: '温馨亲和' },
      { label: '偏极简/留白', target_tag: '极简留白' },
    ],
    placeholder: '或自己描述风格方向...',
  },
  'consecutive-custom::spec': {
    text: '你两次自定义输入了规格需求，能拆成最关键的 1-2 条吗？',
    why: '规格阶段自定义输入容易模糊，拆解为关键点便于精准生成',
    options: [
      { label: '只关心第一条', target_tag: '首要规格' },
      { label: '两条都要', target_tag: '全部规格' },
      { label: '其实只想要默认值', target_tag: '默认规格' },
    ],
    placeholder: '或自己说明优先级...',
  },
  // 阶段切换带跳过 → 确认是否用默认值
  'stage-transition-with-skip::perceive': {
    text: '刚才有几题跳过了，spec 阶段我直接用默认值，可以吗？',
    why: '跳过的题会用默认值，确认后避免后续生成偏离预期',
    options: [
      { label: '用默认值即可', target_tag: '默认值确认' },
      { label: '我想补充一下', target_tag: '补充需求' },
      { label: '重新问那几题', target_tag: '重新提问' },
    ],
    placeholder: '或说明你的偏好...',
  },
  'stage-transition-with-skip::name': {
    text: '刚才 name 阶段有跳过，spec 阶段我会用通用方案，可以吗？',
    why: 'name 阶段跳过会影响 spec 的方向，确认后避免后续生成偏离',
    options: [
      { label: '用通用方案', target_tag: '通用方案确认' },
      { label: '我想指定方向', target_tag: '指定方向' },
    ],
    placeholder: '或说明方向偏好...',
  },
  'stage-transition-with-skip::spec': {
    text: 'spec 阶段有题跳过了，execute 阶段我会用默认技术方案，可以吗？',
    why: 'spec 跳过会影响 execute 的技术选型，确认后避免偏离',
    options: [
      { label: '用默认方案', target_tag: '默认方案确认' },
      { label: '我想指定技术栈', target_tag: '指定技术栈' },
    ],
    placeholder: '或说明技术偏好...',
  },
};

/**
 * r2增强：规则兜底追问生成器
 * 不依赖 LLM，根据 trigger + stage 从模板表生成追问题。
 * 无匹配模板时返回 null（调用方继续原 nextQuestion 流程）。
 */
export function generateRuleBasedFollowup(
  decision: FollowupDecision,
): { question: Question; reason: string } | null {
  const stage = (decision.promptInput.currentStage as PromptStage) ?? 'perceive';
  const key = `${decision.trigger}::${stage}`;
  const template = RULE_FOLLOWUP_TEMPLATES[key];

  if (!template) {
    // 无匹配模板，返回 null（调用方继续原流程）
    return null;
  }

  const question: Question = {
    id: `dyn-rule-followup-${decision.trigger}-${stage}`,
    stage,
    order: 999,
    text: template.text,
    type: 'single-choice',
    options: template.options.map((o) => ({
      label: o.label,
      value: o.target_tag,
      tags: [o.target_tag],
    })),
    allow_custom: true,
    placeholder: template.placeholder ?? '或自己描述...',
    trigger_tags: [],
    jumps: [],
    required: false,
    why: template.why,
  };

  console.info('[SmartFollowup] 规则兜底追问生成', {
    trigger: decision.trigger,
    stage,
    question_text: question.text,
  });

  return { question, reason: `${decision.reason}（规则兜底）` };
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

/** 规范化 LLM 输出（导出用于单元测试） */
export function normalizeOutput(raw: unknown): FollowupLLMOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const question_text = String(r.question_text ?? '').trim();
  if (!question_text) return null;

  const why = String(r.why ?? '').trim() || '基于上下文动态生成';

  const options = Array.isArray(r.options)
    ? (r.options as unknown[])
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
        .slice(0, 5)
        .map((o) => ({
          label: String(o.label ?? '').trim(),
          target_tag: String(o.target_tag ?? '').trim(),
        }))
        .filter((o) => o.label && o.target_tag)
    : [];

  if (options.length < 2) return null; // 至少 2 个选项

  const allow_custom = r.allow_custom !== false; // 默认 true
  const placeholder = r.placeholder ? String(r.placeholder) : undefined;

  return { question_text, why, options, allow_custom, placeholder };
}
