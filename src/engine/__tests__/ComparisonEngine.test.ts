// src/engine/__tests__/ComparisonEngine.test.ts
// R04：前后对比引擎单测——覆盖主要分支：
// 空输入 / 单侧为空 / 完全一致 / 单段差异 / 多段差异 / 段落新增缺失 /
// 段落顺序调整 / 项目上下文单侧缺失 / 约束条目差异 / 形状守卫
import { describe, it, expect } from 'vitest';
import {
  alignParagraphs,
  comparePromptResults,
  diffConstraintItems,
  isPromptResultLike,
  splitParagraphs,
  type ComparisonSegmentKey,
} from '../ComparisonEngine';
import type { PromptResult, PromptSegment } from '@/types/prompt';

function seg(title: string, content: string): PromptSegment {
  return { title, content };
}

/** 测试用 PromptResult 构造器：未传的段为空内容，project_context 默认 null */
function makeResult(parts: {
  project_context?: string | null;
  action?: string;
  spec?: string;
  constraint?: string;
  verify?: string;
}): PromptResult {
  return {
    project_context:
      typeof parts.project_context === 'string'
        ? { title: '项目上下文', content: parts.project_context }
        : null,
    action: seg('要做什么', parts.action ?? ''),
    spec: seg('怎么做', parts.spec ?? ''),
    constraint: seg('不能怎么', parts.constraint ?? ''),
    verify: seg('怎么算做好了', parts.verify ?? ''),
    raw_quotes: [],
    intent_tags: [],
    generated_at: '2026-10-24T00:00:00.000Z',
  };
}

/** 按 key 取段对比结果 */
function segOf(result: ReturnType<typeof comparePromptResults>, key: ComparisonSegmentKey) {
  const found = result.segments.find((s) => s.key === key);
  if (!found) throw new Error(`segment ${key} not found`);
  return found;
}

describe('splitParagraphs', () => {
  it('按行拆分并过滤空行、去除首尾空白', () => {
    expect(splitParagraphs('  a  \n\n b\n   \nc')).toEqual(['a', 'b', 'c']);
  });

  it('空字符串返回空数组', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('\n \n')).toEqual([]);
  });
});

describe('alignParagraphs', () => {
  it('完全一致时全部 same', () => {
    const items = alignParagraphs(['a', 'b'], ['a', 'b']);
    expect(items.every((i) => i.status === 'same')).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('右侧纯新增：多出段落标记 added 且 left 为 null', () => {
    const items = alignParagraphs(['a'], ['a', 'b']);
    expect(items).toEqual([
      { status: 'same', left: 'a', right: 'a' },
      { status: 'added', left: null, right: 'b' },
    ]);
  });

  it('左侧纯缺失：多出段落标记 removed 且 right 为 null', () => {
    const items = alignParagraphs(['a', 'b'], ['a']);
    expect(items).toEqual([
      { status: 'same', left: 'a', right: 'a' },
      { status: 'removed', left: 'b', right: null },
    ]);
  });

  it('中间插入：保持前后 same，插入段 added', () => {
    const items = alignParagraphs(['a', 'c'], ['a', 'b', 'c']);
    expect(items.map((i) => i.status)).toEqual(['same', 'added', 'same']);
  });

  it('两侧均无后续匹配时：左侧 removed + 右侧 added', () => {
    const items = alignParagraphs(['x'], ['y']);
    expect(items).toEqual([
      { status: 'removed', left: 'x', right: null },
      { status: 'added', left: null, right: 'y' },
    ]);
  });

  it('一侧为空数组：全部为另一侧的新增/缺失', () => {
    expect(alignParagraphs([], ['a', 'b']).every((i) => i.status === 'added')).toBe(true);
    expect(alignParagraphs(['a', 'b'], []).every((i) => i.status === 'removed')).toBe(true);
    expect(alignParagraphs([], [])).toEqual([]);
  });

  it('顺序调整：产生新增与缺失标记', () => {
    const items = alignParagraphs(['a', 'b'], ['b', 'a']);
    const statuses = items.map((i) => i.status);
    expect(statuses).toContain('added');
    expect(statuses).toContain('removed');
    expect(statuses).toContain('same');
  });
});

describe('diffConstraintItems', () => {
  it('完全一致全部 same', () => {
    const items = diffConstraintItems('不得使用 any\n保持移动优先', '不得使用 any\n保持移动优先');
    expect(items.map((i) => i.status)).toEqual(['same', 'same']);
  });

  it('新增/缺失/保持三种状态', () => {
    const items = diffConstraintItems('不得使用 any\n保持移动优先', '不得使用 any\n必须支持深色/浅色');
    expect(items).toEqual([
      { status: 'same', text: '不得使用 any' },
      { status: 'removed', text: '保持移动优先' },
      { status: 'added', text: '必须支持深色/浅色' },
    ]);
  });

  it('单侧为空：全部为另一侧状态', () => {
    expect(diffConstraintItems('', 'a\nb').every((i) => i.status === 'added')).toBe(true);
    expect(diffConstraintItems('a\nb', '').every((i) => i.status === 'removed')).toBe(true);
    expect(diffConstraintItems('', '')).toEqual([]);
  });
});

describe('comparePromptResults', () => {
  it('空输入（两侧均为空结果）不抛错且判定一致', () => {
    const result = comparePromptResults(makeResult({}), makeResult({}));
    expect(result.summary.identical).toBe(true);
    expect(result.summary.totalSegments).toBe(5);
    expect(result.summary.changedSegments).toEqual([]);
    expect(result.summary.changedConstraintItems).toBe(0);
    expect(result.segments.every((s) => s.status === 'same')).toBe(true);
    expect(result.segments.map((s) => s.key)).toEqual([
      'project_context',
      'action',
      'spec',
      'constraint',
      'verify',
    ]);
  });

  it('null / undefined 输入按空结果处理', () => {
    expect(comparePromptResults(null, undefined).summary.identical).toBe(true);
    const half = comparePromptResults(makeResult({ action: '做点什么' }), null);
    expect(half.summary.identical).toBe(false);
    expect(segOf(half, 'action').status).toBe('removed');
  });

  it('完全一致（多段非空）判定 identical', () => {
    const parts = {
      project_context: '当前项目：灵感大王',
      action: '完成以下需求：调整按钮间距',
      spec: '间距: 8px',
      constraint: '不得使用 any',
      verify: '截图确认',
    };
    const result = comparePromptResults(makeResult(parts), makeResult(parts));
    expect(result.summary.identical).toBe(true);
    expect(result.summary.changedSegments).toEqual([]);
  });

  it('纯空白差异（尾随换行）不视为差异', () => {
    const result = comparePromptResults(
      makeResult({ action: '完成需求：A' }),
      makeResult({ action: '完成需求：A\n\n' }),
    );
    expect(result.summary.identical).toBe(true);
    expect(segOf(result, 'action').status).toBe('same');
  });

  it('单段差异：仅 action 标记 changed，段落含新增+缺失', () => {
    const result = comparePromptResults(
      makeResult({ action: '完成以下需求：A\n（衔接上文：旧）' }),
      makeResult({ action: '完成以下需求：B\n（衔接上文：新）' }),
    );
    expect(result.summary.changedSegments).toEqual(['action']);
    expect(segOf(result, 'action').status).toBe('changed');
    const statuses = segOf(result, 'action').paragraphs.map((p) => p.status);
    expect(statuses).toContain('removed');
    expect(statuses).toContain('added');
    expect(segOf(result, 'spec').status).toBe('same');
  });

  it('多段差异：changedSegments 保持固定段序', () => {
    const result = comparePromptResults(
      makeResult({ action: 'A', verify: 'V1' }),
      makeResult({ action: 'B', verify: 'V2' }),
    );
    expect(result.summary.changedSegments).toEqual(['action', 'verify']);
    expect(segOf(result, 'action').status).toBe('changed');
    expect(segOf(result, 'verify').status).toBe('changed');
  });

  it('段落新增：右侧多出的段落标记 added', () => {
    const result = comparePromptResults(
      makeResult({ spec: '间距: 8px' }),
      makeResult({ spec: '间距: 8px\n圆角: 4px' }),
    );
    const added = segOf(result, 'spec').paragraphs.filter((p) => p.status === 'added');
    expect(added).toHaveLength(1);
    expect(added[0].left).toBeNull();
    expect(added[0].right).toBe('圆角: 4px');
  });

  it('段落缺失：左侧多出的段落标记 removed', () => {
    const result = comparePromptResults(
      makeResult({ verify: '标准1\n标准2' }),
      makeResult({ verify: '标准1' }),
    );
    const removed = segOf(result, 'verify').paragraphs.filter((p) => p.status === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].right).toBeNull();
    expect(removed[0].left).toBe('标准2');
  });

  it('project_context 单侧缺失：左有右无记 removed，左无右有记 added', () => {
    const leftHas = comparePromptResults(
      makeResult({ project_context: '当前项目：X' }),
      makeResult({}),
    );
    expect(segOf(leftHas, 'project_context').status).toBe('removed');

    const rightHas = comparePromptResults(
      makeResult({}),
      makeResult({ project_context: '当前项目：X' }),
    );
    expect(segOf(rightHas, 'project_context').status).toBe('added');
  });

  it('约束条目差异：same/added/removed 三类且计入摘要', () => {
    const result = comparePromptResults(
      makeResult({ constraint: '不得使用 any\n保持移动优先' }),
      makeResult({ constraint: '不得使用 any\n必须同时支持深色/浅色主题切换' }),
    );
    const constraintSeg = segOf(result, 'constraint');
    expect(constraintSeg.constraintItems).toEqual([
      { status: 'same', text: '不得使用 any' },
      { status: 'removed', text: '保持移动优先' },
      { status: 'added', text: '必须同时支持深色/浅色主题切换' },
    ]);
    expect(result.summary.changedConstraintItems).toBe(2);
    // 非约束段不挂 constraintItems
    expect(segOf(result, 'action').constraintItems).toBeUndefined();
  });

  it('约束条目完全一致时 changedConstraintItems 为 0', () => {
    const result = comparePromptResults(
      makeResult({ constraint: '不得使用 any' }),
      makeResult({ constraint: '不得使用 any' }),
    );
    expect(result.summary.changedConstraintItems).toBe(0);
    expect(segOf(result, 'constraint').constraintItems?.[0].status).toBe('same');
  });

  it('段落标题取有内容一侧', () => {
    const result = comparePromptResults(
      makeResult({}),
      makeResult({ action: '做事' }),
    );
    // 左侧 action 标题为默认「要做什么」，右侧同；project_context 右侧空取左侧默认标题
    expect(segOf(result, 'project_context').title).toBe('项目上下文');
    expect(segOf(result, 'action').title).toBe('要做什么');
  });
});

describe('isPromptResultLike', () => {
  it('合法 PromptResult 返回 true', () => {
    expect(isPromptResultLike(makeResult({ action: 'a' }))).toBe(true);
  });

  it('project_context 为 null 时合法', () => {
    const r = makeResult({});
    expect(r.project_context).toBeNull();
    expect(isPromptResultLike(r)).toBe(true);
  });

  it('缺四段之一返回 false', () => {
    const r = makeResult({ action: 'a' }) as unknown as Record<string, unknown>;
    delete r.verify;
    expect(isPromptResultLike(r)).toBe(false);
  });

  it('段 content 非字符串返回 false', () => {
    const r = makeResult({ action: 'a' });
    (r.action as unknown as { content: unknown }).content = 123;
    expect(isPromptResultLike(r)).toBe(false);
  });

  it('null / 非对象返回 false', () => {
    expect(isPromptResultLike(null)).toBe(false);
    expect(isPromptResultLike(undefined)).toBe(false);
    expect(isPromptResultLike('prompt')).toBe(false);
    expect(isPromptResultLike(42)).toBe(false);
  });

  it('raw_quotes / intent_tags 非数组返回 false', () => {
    const r = makeResult({ action: 'a' });
    (r as unknown as { raw_quotes: unknown }).raw_quotes = 'nope';
    expect(isPromptResultLike(r)).toBe(false);
    const r2 = makeResult({ action: 'a' });
    (r2 as unknown as { intent_tags: unknown }).intent_tags = {};
    expect(isPromptResultLike(r2)).toBe(false);
  });

  it('generated_at 非字符串返回 false', () => {
    const r = makeResult({ action: 'a' });
    (r as unknown as { generated_at: unknown }).generated_at = 123;
    expect(isPromptResultLike(r)).toBe(false);
  });
});
