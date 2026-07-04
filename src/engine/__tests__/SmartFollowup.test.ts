// src/engine/__tests__/SmartFollowup.test.ts
// SmartFollowup.evaluateFollowup 模式排除单测
// 重点验证 P2 修复：quick 模式与 direct 模式一样不触发追问

import { describe, it, expect } from 'vitest';
import { evaluateFollowup, type FollowupEvalContext } from '../SmartFollowup';
import type { Question, PromptStage } from '../types';
import type { Answer } from '@/types/state';
import type { LLMIntentAnalysis } from '../LLMIntentAnalyzer';
import type { ContextRecentQA } from '@/types/context';

function makeQuestion(stage: PromptStage, id = 'q-test'): Question {
  return {
    id,
    stage,
    order: 1,
    text: '测试题',
    type: 'single-choice',
    options: [{ label: '选项A', value: 'a', tags: ['测试'] }],
    allow_custom: true,
    placeholder: '',
    trigger_tags: [],
    jumps: [],
    required: false,
  };
}

function makeAnswer(qid: string): Answer {
  return {
    questionId: qid,
    value: 'a',
    raw: '选项A',
    tags: ['测试'],
    skipped: false,
    answeredAt: new Date().toISOString(),
  };
}

function makeCtx(overrides: Partial<FollowupEvalContext> = {}): FollowupEvalContext {
  const lastQuestion = makeQuestion('perceive', 'p-001');
  const lastAnswer = makeAnswer('p-001');
  const nextQuestion = makeQuestion('spec', 's-001');
  return {
    llmAnalysis: null,
    lastAnswer,
    lastQuestion,
    nextQuestion,
    allAnswers: { 'p-001': lastAnswer },
    alreadyTriggered: false,
    recentQA: [] as ContextRecentQA[],
    seed: '测试种子',
    mode: 'full',
    ...overrides,
  };
}

describe('SmartFollowup.evaluateFollowup 模式排除', () => {
  it('full 模式：满足条件时触发追问（基线）', () => {
    // 构造高歧义场景：llmAnalysis.ambiguity_score > 0.6 + perceive 阶段
    const llmAnalysis: LLMIntentAnalysis = {
      scene: 'frontend-ui',
      pain_points: [],
      detected_dimensions: [],
      urgency: 'medium',
      ambiguity_score: 0.8,
      suggested_followup: null,
      followup_options: [],
      source: 'llm',
    };
    const ctx = makeCtx({ llmAnalysis, mode: 'full' });
    const decision = evaluateFollowup(ctx);
    expect(decision).not.toBeNull();
    expect(decision!.trigger).toBe('high-ambiguity');
  });

  it('direct 模式：始终不触发追问（已有逻辑）', () => {
    const llmAnalysis: LLMIntentAnalysis = {
      scene: 'frontend-ui',
      pain_points: [],
      detected_dimensions: [],
      urgency: 'medium',
      ambiguity_score: 0.8,
      suggested_followup: null,
      followup_options: [],
      source: 'llm',
    };
    const ctx = makeCtx({ llmAnalysis, mode: 'direct' });
    const decision = evaluateFollowup(ctx);
    expect(decision).toBeNull();
  });

  it('quick 模式：不触发追问（P2 修复）', () => {
    // 同样的高歧义场景，quick 模式应被排除
    const llmAnalysis: LLMIntentAnalysis = {
      scene: 'frontend-ui',
      pain_points: [],
      detected_dimensions: [],
      urgency: 'medium',
      ambiguity_score: 0.8,
      suggested_followup: null,
      followup_options: [],
      source: 'llm',
    };
    const ctx = makeCtx({ llmAnalysis, mode: 'quick' });
    const decision = evaluateFollowup(ctx);
    expect(decision).toBeNull();
  });

  it('quick 模式：连续自定义输入也不触发追问', () => {
    // 构造连续自定义输入场景
    const lastQuestion = makeQuestion('perceive', 'p-002');
    const lastAnswer: Answer = {
      questionId: 'p-002',
      value: '自定义内容',
      raw: '我想要更具体的间距',
      tags: [],
      skipped: false,
      answeredAt: new Date().toISOString(),
    };
    const prevAnswer: Answer = {
      questionId: 'p-001',
      value: '另一个自定义',
      raw: '之前的自定义内容',
      tags: [],
      skipped: false,
      answeredAt: new Date().toISOString(),
    };
    const ctx = makeCtx({
      lastQuestion,
      lastAnswer,
      allAnswers: { 'p-001': prevAnswer, 'p-002': lastAnswer },
      mode: 'quick',
    });
    const decision = evaluateFollowup(ctx);
    expect(decision).toBeNull();
  });

  it('quick 模式：阶段切换带跳过也不触发追问', () => {
    const lastQuestion = makeQuestion('perceive', 'p-001');
    const lastAnswer = makeAnswer('p-001');
    const skippedAnswer: Answer = {
      questionId: 'p-002',
      value: '__skipped__',
      raw: '',
      tags: [],
      skipped: true,
      answeredAt: new Date().toISOString(),
    };
    const nextQuestion = makeQuestion('spec', 's-001');
    const ctx = makeCtx({
      lastQuestion,
      lastAnswer,
      nextQuestion,
      allAnswers: { 'p-001': lastAnswer, 'p-002': skippedAnswer },
      mode: 'quick',
    });
    const decision = evaluateFollowup(ctx);
    expect(decision).toBeNull();
  });

  it('alreadyTriggered=true 时 full 模式也不触发（防重）', () => {
    const llmAnalysis: LLMIntentAnalysis = {
      scene: 'frontend-ui',
      pain_points: [],
      detected_dimensions: [],
      urgency: 'medium',
      ambiguity_score: 0.8,
      suggested_followup: null,
      followup_options: [],
      source: 'llm',
    };
    const ctx = makeCtx({ llmAnalysis, mode: 'full', alreadyTriggered: true });
    const decision = evaluateFollowup(ctx);
    expect(decision).toBeNull();
  });
});
