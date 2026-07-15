// src/engine/评价词典.ts
// 评价→规格映射表：把"太挤/太丑/不够高级"等模糊评价转成可量化规格
// 每条规则包含：关键词、对应的 spec 段建议（规格段会引用）、对应的追问提示

export interface EvaluationEntry {
  keyword: string;
  label: string; // 用于 chip 展示
  specSuggestion: string; // 规格段建议文本
  followupHint?: string; // 触发追问提示
}

export const EVALUATION_DICT: EvaluationEntry[] = [
  {
    keyword: '太挤',
    label: '间距: 太挤',
    specSuggestion: '卡片内边距由 8px 增加至 16px；卡片间垂直间距由 12px 增加至 20px',
    followupHint: '具体是哪种"挤"：内边距、行间距，还是组件之间？',
  },
  {
    keyword: '太丑',
    label: '视觉: 太丑',
    specSuggestion: '收敛配色到主色+1强调色；统一圆角到 8px；检查元素是否按 8px 网格对齐',
    followupHint: '丑具体是指颜色、对齐、字号还是圆角？',
  },
  {
    keyword: '不够高级',
    label: '质感: 不够高级',
    specSuggestion: '增加留白（内边距 ≥ 16px）+ 提升对比度（≥ 4.5:1）+ 加入过渡动效',
    followupHint: '高级感差在：留白、对比度还是动效？',
  },
  {
    keyword: '乱',
    label: '视觉: 乱',
    specSuggestion: '统一间距到 8px 网格；统一字号层级（3 级）；收敛颜色到主色 + 1 强调色',
    followupHint: '乱主要来自：间距不统一、字号层级缺失、颜色太多还是对齐错位？',
  },
  {
    keyword: '看不清',
    label: '可读性: 看不清',
    specSuggestion: '文字与背景对比度提升至 WCAG AA 4.5:1；正文最小字号 12px',
    followupHint: '看不清是文字对比度低、字号太小还是图标过细？',
  },
  {
    keyword: '呆板',
    label: '动效: 呆板',
    specSuggestion: '为进出场添加 200ms cubic-bezier(0.4,0,0.2,1) 过渡；hover 添加 scale(1.02)',
    followupHint: '呆板希望加入：进出场动效、hover 反馈还是状态过渡？',
  },
  {
    keyword: '不统一',
    label: '一致性: 不统一',
    specSuggestion: '提取设计 token：间距 8/12/16/24；圆角 4/8/12；字号 12/14/18/24',
    followupHint: '不统一最明显的是：按钮、间距、颜色还是圆角？',
  },
  {
    keyword: '刺眼',
    label: '配色: 刺眼',
    specSuggestion: '降低主色饱和度（HSL S 降 15%）；背景与主色对比度收敛到 4.5-7:1',
    followupHint: '刺眼是哪种：主色饱和度过高、对比过强还是配色组合冲突？',
  },
];

/** 从文本中匹配评价关键词 */
export function matchEvaluations(text: string): EvaluationEntry[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return EVALUATION_DICT.filter((e) => lower.includes(e.keyword.toLowerCase()));
}

/** 把评价展开为规格段建议列表 */
export function expandToSpecs(text: string): string[] {
  return matchEvaluations(text).map((e) => e.specSuggestion);
}
