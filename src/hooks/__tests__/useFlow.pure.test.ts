// src/hooks/__tests__/useFlow.pure.test.ts
// useFlow 的三个纯函数单测（无需渲染 React，也不依赖 Tauri）。
// 抽出来的理由：这些函数是「偏好推荐 / 上下文构建」的核心逻辑，
// R04 那类「状态放错层导致一关面板就丢」的缺陷高发在这一层，值得锁死契约。
import { describe, it, expect } from 'vitest';
import { computeRecommendation, extractPreferencesFromEngine, PREFERENCE_LABELS } from '../useFlow';
import type { Question } from '@/engine/types';
import type { ContextRecentQA, ContextPreference } from '@/types/context';

/** 造一个最小可用的 Question（只填 computeRecommendation 会读的字段） */
function q(
  id: string,
  options: Array<{ value: string; label: string; tags?: string[] }> = [],
): Question {
  return {
    id,
    stage: 'spec',
    order: 1,
    text: `问题 ${id}`,
    type: 'single-choice',
    options: options.map((o) => ({ value: o.value, label: o.label, tags: o.tags ?? [] })),
    allow_custom: false,
    trigger_tags: [],
    jumps: [],
    required: true,
  } as Question;
}

function qa(questionId: string, answer: string): ContextRecentQA {
  return {
    question_id: questionId,
    question_text: `问题 ${questionId}`,
    answer,
    answered_at: '2026-10-29T00:00:00.000Z',
  };
}

function pref(key: string, value: string): ContextPreference {
  return { key, value, confirmed_at: '2026-10-29T00:00:00.000Z' };
}

describe('PREFERENCE_LABELS', () => {
  it('收录固定的稳定偏好维度集合', () => {
    expect([...PREFERENCE_LABELS].sort()).toEqual(
      ['主题', '响应式', '影响', '框架', '样式方案', '场景', '语言', '验证标准'].sort(),
    );
  });
});

describe('computeRecommendation（偏好推荐双链路）', () => {
  it('新用户（两源皆空）直接短路返回空数组', () => {
    const question = q('e-001', [{ value: 'a', label: 'A' }]);
    expect(computeRecommendation(question, [], [])).toEqual([]);
  });

  it('无历史命中时返回空数组（不瞎推荐）', () => {
    const question = q('e-999', [{ value: 'a', label: 'A', tags: [] }]);
    // 历史答的是别的问题，且无偏好
    expect(computeRecommendation(question, [qa('other-q', '无所谓')], [])).toEqual([]);
  });

  it('链路①：同题历史一致 → 推荐对应选项 value', () => {
    // 同一题连续 3 次都答 x，应推荐 x
    const question = q('e-001', [
      { value: 'only', label: '就改这一个地方' },
      { value: 'everywhere', label: '全局都改' },
    ]);
    const history = [qa('e-001', 'only'), qa('e-001', 'only'), qa('e-001', 'only')];
    expect(computeRecommendation(question, history, [])).toContain('only');
  });

  it('链路①：历史答案存的是 label 时也能匹配回 value', () => {
    const question = q('e-001', [
      { value: 'only', label: '就改这一个地方' },
      { value: 'everywhere', label: '全局都改' },
    ]);
    // 历史里存的是 label 文本而非 value
    const history = [
      qa('e-001', '就改这一个地方'),
      qa('e-001', '就改这一个地方'),
      qa('e-001', '就改这一个地方'),
    ];
    expect(computeRecommendation(question, history, [])).toContain('only');
  });

  it('链路②：稳定偏好按 key:value 匹配选项 tags（忽略空格）', () => {
    const question = q('e-002', [
      { value: 'mobile', label: '手机', tags: ['场景: 移动端'] },
      { value: 'desktop', label: '桌面', tags: ['场景: 桌面'] },
    ]);
    // 偏好 value 与 tag 的 "场景: 移动端" 去空格后一致
    expect(computeRecommendation(question, [], [pref('场景', '移动端')])).toEqual(['mobile']);
  });

  it('链路②：偏好与 tags 都带空格时仍能匹配（归一化）', () => {
    const question = q('e-002', [
      { value: 'mobile', label: '手机', tags: ['  场景 :   移动端  '] },
    ]);
    expect(computeRecommendation(question, [], [pref(' 场景 ', ' 移动端 ')])).toEqual(['mobile']);
  });

  it('两条链路同时命中时去重（Set 语义，不返回重复 value）', () => {
    const question = q('e-001', [
      { value: 'only', label: '就改这一个地方', tags: ['影响: 局部'] },
      { value: 'everywhere', label: '全局', tags: ['影响: 全局'] },
    ]);
    const history = [qa('e-001', 'only'), qa('e-001', 'only'), qa('e-001', 'only')];
    const prefs = [pref('影响', '局部')];
    const res = computeRecommendation(question, history, prefs);
    // 两条链路都指向 only，结果里只能出现一次
    expect(res.filter((v) => v === 'only')).toHaveLength(1);
  });

  it('偏好 key 不在选项 tags 里时不产生推荐', () => {
    const question = q('e-003', [{ value: 'a', label: 'A', tags: ['无关: 值'] }]);
    expect(computeRecommendation(question, [], [pref('场景', '移动端')])).toEqual([]);
  });

  it('minCount=1 生效：单条偏好即可推荐（appendPreferences 对同 key 去重，count 恒为 1）', () => {
    const question = q('e-004', [{ value: 'v', label: 'L', tags: ['框架: React'] }]);
    expect(computeRecommendation(question, [], [pref('框架', 'React')])).toEqual(['v']);
  });
});

describe('extractPreferencesFromEngine（从引擎提取稳定偏好）', () => {
  /** 造一个只实现被读取方法的假 engine */
  function fakeEngine(
    tags: Array<{ label: string; value: string }>,
    llmDims?: Array<{ tag: string }>,
  ) {
    return {
      getIntentTags: () => tags,
      getLLMAnalysis: () => (llmDims ? { detected_dimensions: llmDims } : null),
    } as unknown as Parameters<typeof extractPreferencesFromEngine>[0];
  }

  it('只提取 PREFERENCE_LABELS 内的标签', () => {
    const engine = fakeEngine([
      { label: '场景', value: '修UI' },
      { label: '临时噪音', value: '不该出现在偏好里' },
      { label: '框架', value: 'React' },
    ]);
    const prefs = extractPreferencesFromEngine(engine);
    expect(prefs.map((p) => p.key).sort()).toEqual(['场景', '框架']);
  });

  it('同 key 同 value 去重（不重复写偏好）', () => {
    const engine = fakeEngine([
      { label: '场景', value: '修UI' },
      { label: '场景', value: '修UI' },
    ]);
    expect(extractPreferencesFromEngine(engine)).toHaveLength(1);
  });

  it('value 为空的标签被跳过', () => {
    const engine = fakeEngine([{ label: '场景', value: '' }]);
    expect(extractPreferencesFromEngine(engine)).toEqual([]);
  });

  it('合并 LLM 分析的 detected_dimensions（tag 形如 "label:value"）', () => {
    const engine = fakeEngine([], [{ tag: '语言:TypeScript' }]);
    const prefs = extractPreferencesFromEngine(engine);
    expect(prefs).toEqual([
      expect.objectContaining({ key: '语言', value: 'TypeScript' }),
    ]);
  });

  it('LLM 维度里不在 PREFERENCE_LABELS 的标签被过滤', () => {
    const engine = fakeEngine([], [{ tag: '噪音:值' }, { tag: '框架:Vue' }]);
    expect(extractPreferencesFromEngine(engine).map((p) => p.key)).toEqual(['框架']);
  });

  it('LLM 维度与意图标签重复时只保留一条', () => {
    const engine = fakeEngine([{ label: '场景', value: '修UI' }], [{ tag: '场景:修UI' }]);
    expect(extractPreferencesFromEngine(engine)).toHaveLength(1);
  });

  it('每个偏好都带 confirmed_at 时间戳（ISO 格式）', () => {
    const engine = fakeEngine([{ label: '场景', value: '修UI' }]);
    const [first] = extractPreferencesFromEngine(engine);
    expect(first.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('无标签也无 LLM 分析时返回空数组', () => {
    expect(extractPreferencesFromEngine(fakeEngine([]))).toEqual([]);
  });
});
