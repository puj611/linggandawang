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

// P2 补充：quickMode 过滤分支单测（原有测试覆盖率为 0）
describe('Selector quickMode 过滤', () => {
  it('quickMode=true 时只选 quick_mode: true 的题', () => {
    const sel = makeSelector();
    const q = sel.select({
      stage: 'perceive',
      askedIds: [],
      intentTags: [],
      answers: {},
      quickMode: true,
    });
    expect(q).not.toBeNull();
    expect(q!.quick_mode).toBe(true);
  });

  it('quickMode=true 时 forcedNextId 指向非 quick 题会被过滤（返回评分最高的 quick 题）', () => {
    const sel = makeSelector();
    // n-002 不是 quick_mode 题，forcedNextId 应被过滤
    const q = sel.select({
      stage: 'name',
      askedIds: [],
      intentTags: [],
      answers: {},
      forcedNextId: 'n-002',
      quickMode: true,
    });
    expect(q).not.toBeNull();
    // 不应返回 n-002（非 quick）
    expect(q!.id).not.toBe('n-002');
    expect(q!.quick_mode).toBe(true);
  });

  it('firstOfStage(verify, true) 返回 quick 题而非 v-001 之后的无 quick 题', () => {
    const sel = makeSelector();
    const q = sel.firstOfStage('verify', true);
    expect(q).not.toBeNull();
    expect(q!.quick_mode).toBe(true);
    // v-001 现已标记 quick_mode: true（P1 修复）
    expect(q!.id).toBe('v-001');
  });

  it('quickMode=false（默认）时返回任意题（含非 quick）', () => {
    const sel = makeSelector();
    const q = sel.select({
      stage: 'verify',
      askedIds: [],
      intentTags: [],
      answers: {},
      // quickMode 未传，默认 false
    });
    expect(q).not.toBeNull();
    // 不强制 quick_mode，只要返回 verify 阶段的题即可
    expect(q!.stage).toBe('verify');
  });

  it('quickMode=true 时所有阶段都能选到 quick 题（不返回 null）', () => {
    const sel = makeSelector();
    for (const stage of ['perceive', 'name', 'spec', 'execute', 'verify'] as const) {
      const q = sel.firstOfStage(stage, true);
      expect(q, `阶段 ${stage} 应有 quick 题`).not.toBeNull();
      expect(q!.quick_mode).toBe(true);
    }
  });
});
