// src/engine/ComparisonEngine.ts
// 前后对比引擎（R04 MVP）：同一份输入的两版提示词 → 差异结构（分段差异 + 约束条目差异）
//
// 设计约束（路线图 R04 任务卡）：
//   1. 引擎层为纯函数：无 IO、无 React/Tauri 依赖，可独立单测；
//   2. 不做字符级 diff 算法：按「段落」对齐，仅做新增/缺失标记；
//   3. MVP 只对比四段结构（含项目上下文段）与约束条目，不做语义评分；
//   4. 输入兼容 null/undefined（视为空结果），整体或单侧为空不抛错。
import type { PromptResult, PromptSegment } from '@/types/prompt';

/** 参与对比的段落 key（与 PromptResult 字段一一对应） */
export type ComparisonSegmentKey = 'project_context' | 'action' | 'spec' | 'constraint' | 'verify';

/** 段落级差异状态：same=一致 / added=仅右侧（新版）有 / removed=仅左侧（旧版）有 */
export type ParagraphStatus = 'same' | 'added' | 'removed';

/** 段落对齐结果项 */
export interface ParagraphDiffItem {
  status: ParagraphStatus;
  /** 左侧（旧版）段落文本；status 为 added 时为 null */
  left: string | null;
  /** 右侧（新版）段落文本；status 为 removed 时为 null */
  right: string | null;
}

/** 约束条目差异状态：same=两侧一致 / added=仅新版有 / removed=仅旧版有 */
export type ConstraintItemStatus = 'same' | 'added' | 'removed';

/** 约束条目差异项（约束段按行视为「约束条目」） */
export interface ConstraintItemDiff {
  status: ConstraintItemStatus;
  /** 条目文本（added 取右侧文本，same/removed 取左侧文本） */
  text: string;
}

/** 段落级差异状态：same=一致 / changed=两侧都有但不同 / added=仅新版有 / removed=仅旧版有 */
export type SegmentStatus = 'same' | 'changed' | 'added' | 'removed';

/** 单个段落的对比结果 */
export interface SegmentComparison {
  key: ComparisonSegmentKey;
  /** 段落标题（优先取有内容一侧的标题，均空时用默认标题） */
  title: string;
  status: SegmentStatus;
  /** 段落对齐结果（按段落粒度做新增/缺失标记） */
  paragraphs: ParagraphDiffItem[];
  /** 约束条目差异（仅 constraint 段填充，其余段为 undefined） */
  constraintItems?: ConstraintItemDiff[];
}

/** 对比摘要（供 UI 顶部徽标使用） */
export interface ComparisonSummary {
  /** 两侧是否完全一致 */
  identical: boolean;
  /** 有差异的段落 key 列表（保持固定段序） */
  changedSegments: ComparisonSegmentKey[];
  /** 参与对比的段落总数（固定 5） */
  totalSegments: number;
  /** 约束条目差异数（added + removed，不含 same） */
  changedConstraintItems: number;
}

/** 两条 PromptResult 的完整对比结果 */
export interface ComparisonResult {
  summary: ComparisonSummary;
  segments: SegmentComparison[];
}

/** 段落定义表：固定段序 + 默认标题（与 PromptGenerator 的四段结构一致） */
const SEGMENT_DEFS: ReadonlyArray<{ key: ComparisonSegmentKey; defaultTitle: string }> = [
  { key: 'project_context', defaultTitle: '项目上下文' },
  { key: 'action', defaultTitle: '要做什么（动作段）' },
  { key: 'spec', defaultTitle: '怎么做（规格段）' },
  { key: 'constraint', defaultTitle: '不能怎么（约束段）' },
  { key: 'verify', defaultTitle: '怎么算做好了（验证段）' },
];

/** 归一化后的段落内容（标题 + 正文，空结果为空格串） */
interface NormalizedSegment {
  title: string;
  content: string;
}

/**
 * 按行拆分段落：去除首尾空白并过滤空行。
 * 段落对齐与约束条目对比均基于此归一化结果，避免尾随换行制造噪声差异。
 */
export function splitParagraphs(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * 段落对齐（贪心前瞻，非字符级 diff）：
 * 逐段比较，遇差异时看哪一侧的下一段能更早在对面后续段落中找到匹配——
 * 能匹配的一侧继续前进，另一侧标记为新增/缺失；两侧后续均无匹配时，
 * 左侧段落记 removed、右侧段落记 added。
 */
export function alignParagraphs(left: string[], right: string[]): ParagraphDiffItem[] {
  const items: ParagraphDiffItem[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      items.push({ status: 'same', left: left[i], right: right[j] });
      i += 1;
      j += 1;
      continue;
    }
    const nextLeftInRight = right.indexOf(left[i], j + 1);
    const nextRightInLeft = left.indexOf(right[j], i + 1);
    if (nextLeftInRight !== -1 && (nextRightInLeft === -1 || nextLeftInRight - j <= nextRightInLeft - i)) {
      // 左侧当前段能在右侧后续找到：右侧当前段是新增
      items.push({ status: 'added', left: null, right: right[j] });
      j += 1;
    } else if (nextRightInLeft !== -1) {
      // 右侧当前段能在左侧后续找到：左侧当前段是缺失
      items.push({ status: 'removed', left: left[i], right: null });
      i += 1;
    } else {
      // 两侧后续均无匹配：左侧缺失 + 右侧新增
      items.push({ status: 'removed', left: left[i], right: null });
      items.push({ status: 'added', left: null, right: right[j] });
      i += 1;
      j += 1;
    }
  }
  while (i < left.length) {
    items.push({ status: 'removed', left: left[i], right: null });
    i += 1;
  }
  while (j < right.length) {
    items.push({ status: 'added', left: null, right: right[j] });
    j += 1;
  }
  return items;
}

/**
 * 约束条目差异：约束段按行视为条目，用集合语义标记 same/added/removed。
 * 输出顺序：先左侧条目（same/removed 保持左序），再右侧独有条目（added 保持右序）。
 */
export function diffConstraintItems(leftContent: string, rightContent: string): ConstraintItemDiff[] {
  const leftItems = splitParagraphs(leftContent);
  const rightItems = splitParagraphs(rightContent);
  const rightSet = new Set(rightItems);
  const leftSet = new Set(leftItems);
  const items: ConstraintItemDiff[] = [];
  for (const text of leftItems) {
    items.push({ status: rightSet.has(text) ? 'same' : 'removed', text });
  }
  for (const text of rightItems) {
    if (!leftSet.has(text)) {
      items.push({ status: 'added', text });
    }
  }
  return items;
}

/**
 * 对比两条 PromptResult，输出差异结构。
 *
 * @param left 旧版结果（A 侧）；null/undefined 按空结果处理
 * @param right 新版结果（B 侧）；null/undefined 按空结果处理
 * @returns 分段对比 + 约束条目差异 + 摘要
 */
export function comparePromptResults(
  left: PromptResult | null | undefined,
  right: PromptResult | null | undefined,
): ComparisonResult {
  const segments: SegmentComparison[] = SEGMENT_DEFS.map(({ key, defaultTitle }) => {
    const leftSeg = extractSegment(left, key, defaultTitle);
    const rightSeg = extractSegment(right, key, defaultTitle);
    // 标题优先取有内容一侧，两侧皆空时取左侧（默认）标题
    const title = rightSeg.content.trim().length > 0 ? rightSeg.title : leftSeg.title;
    const comparison: SegmentComparison = {
      key,
      title,
      status: resolveSegmentStatus(leftSeg.content, rightSeg.content),
      paragraphs: alignParagraphs(splitParagraphs(leftSeg.content), splitParagraphs(rightSeg.content)),
    };
    if (key === 'constraint') {
      comparison.constraintItems = diffConstraintItems(leftSeg.content, rightSeg.content);
    }
    return comparison;
  });

  const changedSegments = segments.filter((s) => s.status !== 'same').map((s) => s.key);
  const constraintSegment = segments.find((s) => s.key === 'constraint');
  const changedConstraintItems = (constraintSegment?.constraintItems ?? []).filter(
    (item) => item.status !== 'same',
  ).length;

  return {
    summary: {
      identical: changedSegments.length === 0,
      changedSegments,
      totalSegments: segments.length,
      changedConstraintItems,
    },
    segments,
  };
}

/**
 * 从（可能为空的）PromptResult 中提取指定段落，缺失字段归一化为空内容。
 * 对持久化 JSON 反序列化后的缺字段对象同样安全。
 */
function extractSegment(
  result: PromptResult | null | undefined,
  key: ComparisonSegmentKey,
  defaultTitle: string,
): NormalizedSegment {
  if (!result) return { title: defaultTitle, content: '' };
  if (key === 'project_context') {
    const seg = result.project_context;
    return { title: seg?.title ?? defaultTitle, content: seg?.content ?? '' };
  }
  const seg: PromptSegment | undefined = result[key];
  return { title: seg?.title ?? defaultTitle, content: seg?.content ?? '' };
}

/** 段落级状态判定：trim 后完全相同视为一致（忽略纯空白噪声） */
function resolveSegmentStatus(leftContent: string, rightContent: string): SegmentStatus {
  const left = leftContent.trim();
  const right = rightContent.trim();
  if (left === right) return 'same';
  if (left.length === 0) return 'added';
  if (right.length === 0) return 'removed';
  return 'changed';
}

/**
 * PromptResult 形状守卫：用于持久化 JSON 反序列化后的校验（unknown → 类型收窄）。
 * 四段必填且 title/content 均为字符串；project_context 允许 null/缺失；
 * raw_quotes / intent_tags 必须为数组，generated_at 必须为字符串。
 */
export function isPromptResultLike(value: unknown): value is PromptResult {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  for (const key of ['action', 'spec', 'constraint', 'verify'] as const) {
    const seg = obj[key];
    if (typeof seg !== 'object' || seg === null) return false;
    const record = seg as Record<string, unknown>;
    if (typeof record.title !== 'string' || typeof record.content !== 'string') return false;
  }
  if (obj.project_context !== null && obj.project_context !== undefined) {
    const pc = obj.project_context as Record<string, unknown>;
    if (typeof pc !== 'object' || pc === null) return false;
    if (typeof pc.title !== 'string' || typeof pc.content !== 'string') return false;
  }
  if (!Array.isArray(obj.raw_quotes)) return false;
  if (!Array.isArray(obj.intent_tags)) return false;
  if (typeof obj.generated_at !== 'string') return false;
  return true;
}
