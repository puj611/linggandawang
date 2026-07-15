// src/engine/__tests__/evaluation.test.ts
import { describe, it, expect } from 'vitest';
import { EVALUATION_DICT, matchEvaluations, expandToSpecs } from '../EvaluationDict';

describe('评价词典', () => {
  it('覆盖 PRD 列出的 8 个评价关键词', () => {
    const required = ['太挤', '太丑', '不够高级', '乱', '看不清', '呆板', '不统一', '刺眼'];
    for (const kw of required) {
      expect(EVALUATION_DICT.some((e) => e.keyword === kw)).toBe(true);
    }
  });

  it('matchEvaluations 命中关键词', () => {
    const matches = matchEvaluations('卡片太挤，看着呆板');
    expect(matches.length).toBe(2);
    expect(matches.map((m) => m.keyword).sort()).toEqual(['呆板', '太挤']);
  });

  it('expandToSpecs 把评价转成规格建议', () => {
    const specs = expandToSpecs('太挤');
    expect(specs.length).toBe(1);
    expect(specs[0]).toContain('16px');
  });
});
