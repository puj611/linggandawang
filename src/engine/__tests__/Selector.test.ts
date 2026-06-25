// src/engine/__tests__/Selector.test.ts
import { describe, it, expect } from 'vitest';
import { QuestionLoader } from '../QuestionLoader';
import { Selector } from '../Selector';
import type { IntentTag } from '@/types/intent-tag';

function makeSelector() {
  const loader = new QuestionLoader();
  loader.load();
  return new Selector(loader);
}

describe('Selector 动态选题', () => {
  it('阶段过滤：只从指定阶段选', () => {
    const sel = makeSelector();
    const q = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: [],
      answers: {},
    });
    expect(q).not.toBeNull();
    expect(q!.stage).toBe('spec');
  });

  it('去重：已问过的不选', () => {
    const sel = makeSelector();
    const q1 = sel.select({ stage: 'perceive', askedIds: [], intentTags: [], answers: {} });
    expect(q1).not.toBeNull();
    const q2 = sel.select({
      stage: 'perceive',
      askedIds: [q1!.id],
      intentTags: [],
      answers: {},
    });
    expect(q2).not.toBeNull();
    expect(q2!.id).not.toBe(q1!.id);
  });

  it('trigger_tags 命中：有相关标签时优先选', () => {
    const sel = makeSelector();
    const tags: IntentTag[] = [
      {
        id: 't1',
        label: '维度',
        value: '间距不统一',
        stage: 'name',
        source_question_id: 'n-001',
        source_type: 'option',
        confidence: 1,
        deletable: true,
        created_at: new Date().toISOString(),
      },
    ];
    // 命中 s-001（trigger_tags 包含"维度: 间距不统一"）
    const q = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: tags,
      answers: {},
    });
    expect(q).not.toBeNull();
    expect(q!.trigger_tags).toContain('维度: 间距不统一');
  });

  it('forcedNextId 优先：跳转规则强制', () => {
    const sel = makeSelector();
    const q = sel.select({
      stage: 'perceive',
      askedIds: [],
      intentTags: [],
      answers: {},
      forcedNextId: 'n-001',
    });
    expect(q?.id).toBe('n-001');
  });

  it('firstOfStage 返回阶段首个问题', () => {
    const sel = makeSelector();
    const q = sel.firstOfStage('verify');
    expect(q).not.toBeNull();
    expect(q?.id).toBe('v-001');
  });
});
