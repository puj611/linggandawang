// src/engine/__tests__/PromptGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { PromptGenerator } from '../PromptGenerator';
import type { IntentTag } from '@/types/intent-tag';
import type { Answer } from '@/types/state';

function makeTag(partial: Partial<IntentTag>): IntentTag {
  return {
    id: 'tag-' + Math.random(),
    label: '布局',
    value: '紧凑',
    stage: 'spec',
    source_question_id: 's-001',
    source_type: 'option',
    confidence: 1,
    deletable: true,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

function makeAnswer(partial: Partial<Answer>): Answer {
  return {
    questionId: 'p-001',
    value: 'fix-ui',
    raw: '修一个看不顺眼的 UI',
    tags: [],
    skipped: false,
    answeredAt: new Date().toISOString(),
    ...partial,
  };
}

describe('PromptGenerator 四段拼装', () => {
  it('100% 输出包含四段', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [makeTag({ label: '场景', value: '修UI', stage: 'perceive' })],
      answers: { 'p-001': makeAnswer({}) },
      seedInput: '修卡片',
    });
    expect(result.action).toBeDefined();
    expect(result.spec).toBeDefined();
    expect(result.constraint).toBeDefined();
    expect(result.verify).toBeDefined();
    expect(result.action.content.length).toBeGreaterThan(0);
  });

  it('评价类语句附带量化规格（"太挤" → 内边距 16px）', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {
        'p-001': makeAnswer({ raw: '卡片太挤' }),
      },
      seedInput: '卡片太挤',
    });
    // 规格段应包含"16px"或"20px"
    expect(result.spec.content).toMatch(/(16px|20px|内边距|间距)/);
  });

  it('用户原话保留在 raw_quotes', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {
        'p-001': makeAnswer({ raw: '原话测试' }),
      },
      seedInput: '修 UI',
    });
    expect(result.raw_quotes).toContain('修 UI');
    expect(result.raw_quotes).toContain('原话测试');
  });

  it('toMarkdown 输出四段标题 + 原话注释', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [makeTag({ label: '场景', value: '修UI' })],
      answers: { 'p-001': makeAnswer({ raw: '原话' }) },
      seedInput: '修 UI',
    });
    const md = gen.toMarkdown(result);
    expect(md).toContain('# 你的提示词');
    expect(md).toContain('## 1. 要做什么');
    expect(md).toContain('## 2. 怎么做');
    expect(md).toContain('## 3. 不能怎么');
    expect(md).toContain('## 4. 怎么算做好了');
    expect(md).toContain('<!-- 原话');
  });

  it('regenerate() 基于剩余 tags 重新拼装', () => {
    const gen = new PromptGenerator();
    const tags = [
      makeTag({ id: 't1', label: '场景', value: '修UI', stage: 'perceive' }),
      makeTag({ id: 't2', label: '布局', value: '紧凑', stage: 'spec' }),
    ];
    const r1 = gen.generate({ intentTags: tags, answers: {}, seedInput: '修 UI' });
    const r2 = gen.regenerate(tags.filter((t) => t.id !== 't2'), {}, '修 UI');
    expect(r2.intent_tags.length).toBe(1);
    expect(r2.intent_tags[0].id).toBe('t1');
    expect(r1.intent_tags.length).toBe(2);
  });

  it('意图标签 ≥ 3 时 markdown 包含标签清单', () => {
    const gen = new PromptGenerator();
    const tags = [
      makeTag({ id: 't1', label: '场景', value: '修UI', stage: 'perceive' }),
      makeTag({ id: 't2', label: '布局', value: '紧凑', stage: 'spec' }),
      makeTag({ id: 't3', label: '圆角', value: '8px', stage: 'spec' }),
    ];
    const result = gen.generate({ intentTags: tags, answers: {}, seedInput: '修 UI' });
    const md = gen.toMarkdown(result);
    expect(md).toContain('意图标签清单（3 个）');
  });
});
