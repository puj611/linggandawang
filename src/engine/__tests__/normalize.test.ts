// src/engine/__tests__/normalize.test.ts
// normalizeOutput / normalizeAnalysis 单元测试
// 覆盖 r11 修复的 LLM 输出归一化逻辑（any→unknown + 类型守卫）

import { describe, it, expect, vi } from 'vitest';

// Mock 外部依赖，避免 Tauri 环境和 LLM adapter 在 jsdom 下加载失败
vi.mock('@/lib/llm', () => ({
  getAdapter: vi.fn(),
  OpenAICompatibleAdapter: vi.fn(),
}));
vi.mock('@/stores/apiKeyStore', () => ({
  useApiKeyStore: { getState: () => ({ config: null, hasApiKey: false }) },
}));
vi.mock('./prompts/followup', () => ({
  buildFollowupMessages: vi.fn(),
}));
vi.mock('./prompts/intent-analysis', () => ({
  buildIntentAnalysisMessages: vi.fn(),
}));
vi.mock('./seedRouter', () => ({
  seedRoute: vi.fn(),
}));

import { normalizeOutput } from '../SmartFollowup';
import { normalizeAnalysis } from '../LLMIntentAnalyzer';

describe('SmartFollowup.normalizeOutput', () => {
  it('非对象输入返回 null', () => {
    expect(normalizeOutput(null)).toBeNull();
    expect(normalizeOutput(undefined)).toBeNull();
    expect(normalizeOutput('string')).toBeNull();
    expect(normalizeOutput(123)).toBeNull();
  });

  it('缺少 question_text 返回 null', () => {
    expect(normalizeOutput({ why: 'x', options: [] })).toBeNull();
  });

  it('空 question_text 返回 null', () => {
    expect(normalizeOutput({ question_text: '   ', options: [] })).toBeNull();
  });

  it('options 少于 2 个有效项返回 null', () => {
    const result = normalizeOutput({
      question_text: 'Q1',
      options: [{ label: 'A', target_tag: 't1' }],
    });
    expect(result).toBeNull();
  });

  it('正常输入返回完整结构', () => {
    const result = normalizeOutput({
      question_text: '  你想解决什么问题？  ',
      why: '  需要明确痛点  ',
      options: [
        { label: '性能', target_tag: 'perf' },
        { label: '体验', target_tag: 'ux' },
        { label: '', target_tag: '' },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.question_text).toBe('你想解决什么问题？');
    expect(result!.why).toBe('需要明确痛点');
    expect(result!.options).toHaveLength(2);
    expect(result!.options[0]).toEqual({ label: '性能', target_tag: 'perf' });
    expect(result!.allow_custom).toBe(true);
    expect(result!.placeholder).toBeUndefined();
  });

  it('why 缺失时使用默认文案', () => {
    const result = normalizeOutput({
      question_text: 'Q',
      options: [
        { label: 'A', target_tag: 't1' },
        { label: 'B', target_tag: 't2' },
      ],
    });
    expect(result!.why).toBe('基于上下文动态生成');
  });

  it('allow_custom 显式 false 时为 false', () => {
    const result = normalizeOutput({
      question_text: 'Q',
      allow_custom: false,
      options: [
        { label: 'A', target_tag: 't1' },
        { label: 'B', target_tag: 't2' },
      ],
    });
    expect(result!.allow_custom).toBe(false);
  });

  it('options 超过 5 个时只取前 5 个', () => {
    const opts = Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, target_tag: `t${i}` }));
    const result = normalizeOutput({
      question_text: 'Q',
      options: opts,
    });
    expect(result!.options).toHaveLength(5);
  });

  it('options 中非对象元素被过滤', () => {
    const result = normalizeOutput({
      question_text: 'Q',
      options: [
        null,
        'invalid',
        123,
        { label: 'A', target_tag: 't1' },
        { label: 'B', target_tag: 't2' },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(2);
  });

  it('placeholder 字段被正确提取', () => {
    const result = normalizeOutput({
      question_text: 'Q',
      placeholder: '请输入...',
      options: [
        { label: 'A', target_tag: 't1' },
        { label: 'B', target_tag: 't2' },
      ],
    });
    expect(result!.placeholder).toBe('请输入...');
  });
});

describe('LLMIntentAnalyzer.normalizeAnalysis', () => {
  it('null/undefined 输入返回默认结构（不抛错）', () => {
    const result = normalizeAnalysis(null);
    expect(result.scene).toBe('frontend-ui');
    expect(result.pain_points).toEqual([]);
    expect(result.detected_dimensions).toEqual([]);
    expect(result.urgency).toBe('medium');
    expect(result.ambiguity_score).toBe(0);
    expect(result.suggested_followup).toBeNull();
    expect(result.followup_options).toEqual([]);
    expect(result.source).toBe('llm');
  });

  it('scene 字段归一化', () => {
    expect(normalizeAnalysis({ scene: 'backend-api' }).scene).toBe('backend-api');
    expect(normalizeAnalysis({ scene: 'fullstack' }).scene).toBe('fullstack');
    expect(normalizeAnalysis({ scene: 'unknown' }).scene).toBe('frontend-ui');
    expect(normalizeAnalysis({}).scene).toBe('frontend-ui');
  });

  it('pain_points 截断到 5 个且字段类型正确', () => {
    const pps = Array.from({ length: 8 }, (_, i) => ({
      text: `痛点${i}`,
      dimension: '性能',
      severity: 3,
    }));
    const result = normalizeAnalysis({ pain_points: pps });
    expect(result.pain_points).toHaveLength(5);
    expect(result.pain_points[0]).toEqual({
      text: '痛点0',
      dimension: '性能',
      severity: 3,
    });
  });

  it('pain_points severity 超范围被 clamp 到 1-5', () => {
    const result = normalizeAnalysis({
      pain_points: [
        { text: 'a', dimension: 'x', severity: 10 },
        { text: 'b', dimension: 'x', severity: 0.5 },
        { text: 'c', dimension: 'x', severity: 'invalid' },
      ],
    });
    expect(result.pain_points[0].severity).toBe(5); // 10 clamp 到 5
    expect(result.pain_points[1].severity).toBe(1); // 0.5 clamp 到 1
    expect(result.pain_points[2].severity).toBe(3); // Number('invalid')||3 = 3
  });

  it('detected_dimensions weight 归一化（总和 > 1.01 时按比例缩放）', () => {
    const result = normalizeAnalysis({
      detected_dimensions: [
        { tag: 'a', weight: 0.6, confidence: 0.9 },
        { tag: 'b', weight: 0.6, confidence: 0.8 },
      ],
    });
    expect(result.detected_dimensions[0].weight).toBeCloseTo(0.5, 5);
    expect(result.detected_dimensions[1].weight).toBeCloseTo(0.5, 5);
  });

  it('detected_dimensions weight 总和接近 1.0 时不归一化', () => {
    // 总和 1.0 与 1.0 差 0，不触发归一化
    const result = normalizeAnalysis({
      detected_dimensions: [{ tag: 'a', weight: 1.0, confidence: 0.9 }],
    });
    expect(result.detected_dimensions[0].weight).toBe(1.0);
  });

  it('detected_dimensions weight/confidence clamp 到 0-1', () => {
    const result = normalizeAnalysis({
      detected_dimensions: [
        { tag: 'a', weight: 2, confidence: 2 },
        { tag: 'b', weight: -1, confidence: -1 },
      ],
    });
    expect(result.detected_dimensions[0].weight).toBe(1);
    expect(result.detected_dimensions[0].confidence).toBe(1);
    expect(result.detected_dimensions[1].weight).toBe(0);
    expect(result.detected_dimensions[1].confidence).toBe(0);
  });

  it('urgency 字段归一化', () => {
    expect(normalizeAnalysis({ urgency: 'high' }).urgency).toBe('high');
    expect(normalizeAnalysis({ urgency: 'low' }).urgency).toBe('low');
    expect(normalizeAnalysis({ urgency: 'invalid' }).urgency).toBe('medium');
    expect(normalizeAnalysis({}).urgency).toBe('medium');
  });

  it('ambiguity_score clamp 到 0-1', () => {
    expect(normalizeAnalysis({ ambiguity_score: 0.7 }).ambiguity_score).toBe(0.7);
    expect(normalizeAnalysis({ ambiguity_score: 2 }).ambiguity_score).toBe(1);
    expect(normalizeAnalysis({ ambiguity_score: -1 }).ambiguity_score).toBe(0);
    expect(normalizeAnalysis({ ambiguity_score: 'invalid' }).ambiguity_score).toBe(0);
  });

  it('suggested_followup 字段处理', () => {
    expect(normalizeAnalysis({ suggested_followup: '提示' }).suggested_followup).toBe('提示');
    expect(normalizeAnalysis({}).suggested_followup).toBeNull();
  });

  it('followup_options 截断到 4 个且转为字符串', () => {
    const result = normalizeAnalysis({
      followup_options: [1, 2, 3, 4, 5, 6],
    });
    expect(result.followup_options).toHaveLength(4);
    expect(result.followup_options).toEqual(['1', '2', '3', '4']);
  });

  it('完整结构 round-trip', () => {
    const input = {
      scene: 'backend-api',
      pain_points: [{ text: '慢', dimension: '性能', severity: 4 }],
      detected_dimensions: [{ tag: 'api', weight: 0.7, confidence: 0.8 }],
      urgency: 'high',
      ambiguity_score: 0.3,
      suggested_followup: '继续追问',
      followup_options: ['A', 'B'],
    };
    const result = normalizeAnalysis(input);
    expect(result.scene).toBe('backend-api');
    expect(result.pain_points).toHaveLength(1);
    expect(result.detected_dimensions).toHaveLength(1);
    expect(result.urgency).toBe('high');
    expect(result.ambiguity_score).toBe(0.3);
    expect(result.suggested_followup).toBe('继续追问');
    expect(result.followup_options).toEqual(['A', 'B']);
    expect(result.source).toBe('llm');
  });
});
