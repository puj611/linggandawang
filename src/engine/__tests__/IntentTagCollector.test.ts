// src/engine/__tests__/IntentTagCollector.test.ts
import { describe, it, expect, vi } from 'vitest';
import { IntentTagCollector } from '../IntentTagCollector';
import type { IntentTag } from '@/types/intent-tag';

function makeTag(overrides: Partial<IntentTag> = {}): IntentTag {
  return {
    id: 'tag-1',
    label: '场景',
    value: '修UI',
    stage: 'perceive',
    source_question_id: 'p-001',
    source_type: 'option',
    confidence: 1,
    deletable: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// Mock engine — isComplete 和 getStage 可通过参数控制
function mockEngine(tags: IntentTag[] = [], opts?: { complete?: boolean; stage?: string }) {
  let currentTags = [...tags];
  return {
    getIntentTags: () => currentTags,
    removeIntentTag: (id: string) => {
      currentTags = currentTags.filter((t) => t.id !== id);
      return currentTags;
    },
    isComplete: () => opts?.complete ?? false,
    getStage: () => (opts?.stage ?? 'perceive') as 'COMPLETE',
    getAnswers: () => ({}),
    getSeedInput: () => 'test',
  };
}

// Mock generator
function mockGenerator() {
  return {
    regenerate: vi.fn(() => ({
      action: { content: 'test', title: 'test' },
      spec: { content: '', title: '' },
      constraint: { content: '', title: '' },
      verify: { content: '', title: '' },
      raw_quotes: [],
      intent_tags: [],
      generated_at: '',
    })),
  };
}

describe('IntentTagCollector', () => {
  it('list() 返回引擎的意图标签', () => {
    const tags = [makeTag({ id: 't1' }), makeTag({ id: 't2' })];
    const engine = mockEngine(tags);
    const collector = new IntentTagCollector(engine as never, mockGenerator() as never);
    expect(collector.list()).toHaveLength(2);
    expect(collector.list()[0].id).toBe('t1');
  });

  it('count() 返回标签数量', () => {
    const tags = [makeTag({ id: 't1' }), makeTag({ id: 't2' }), makeTag({ id: 't3' })];
    const engine = mockEngine(tags);
    const collector = new IntentTagCollector(engine as never, mockGenerator() as never);
    expect(collector.count()).toBe(3);
  });

  it('count() 无标签时返回 0', () => {
    const engine = mockEngine([]);
    const collector = new IntentTagCollector(engine as never, mockGenerator() as never);
    expect(collector.count()).toBe(0);
  });

  it('chips() 返回格式化的标签列表', () => {
    const tags = [
      makeTag({ id: 't1', label: '场景', value: '修UI', source_type: 'option', deletable: true }),
      makeTag({ id: 't2', label: '维度', value: '间距', source_type: 'screenshot-diagnosis', deletable: false }),
    ];
    const engine = mockEngine(tags);
    const collector = new IntentTagCollector(engine as never, mockGenerator() as never);
    const chips = collector.chips();
    expect(chips).toHaveLength(2);
    expect(chips[0].display_text).toBe('场景: 修UI');
    expect(chips[0].color).toBe('purple');
    expect(chips[0].deletable).toBe(true);
    expect(chips[1].display_text).toBe('维度: 间距');
    expect(chips[1].color).toBe('yellow');
    expect(chips[1].deletable).toBe(false);
  });

  it('remove() 删除标签并返回 null（引擎未完成时）', () => {
    const engine = mockEngine([makeTag({ id: 't1' }), makeTag({ id: 't2' })], { complete: false, stage: 'perceive' });
    const generator = mockGenerator();
    const collector = new IntentTagCollector(engine as never, generator as never);
    const result = collector.remove('t1');
    expect(result).toBeNull();
    expect(collector.list()).toHaveLength(1);
    expect(collector.list()[0].id).toBe('t2');
  });

  it('remove() 删除标签并触发 regenerate（引擎完成时）', () => {
    const engine = mockEngine([makeTag({ id: 't1' })], { complete: true });
    const generator = mockGenerator();
    const collector = new IntentTagCollector(engine as never, generator as never);
    const result = collector.remove('t1');
    expect(result).not.toBeNull();
    expect(generator.regenerate).toHaveBeenCalled();
  });

  it('remove() 删除标签并触发 regenerate（阶段为 COMPLETE 时）', () => {
    const engine = mockEngine([makeTag({ id: 't1' })], { complete: false, stage: 'COMPLETE' });
    const generator = mockGenerator();
    const collector = new IntentTagCollector(engine as never, generator as never);
    const result = collector.remove('t1');
    expect(result).not.toBeNull();
    expect(generator.regenerate).toHaveBeenCalled();
  });
});
