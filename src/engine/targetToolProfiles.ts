// src/engine/targetToolProfiles.ts
// 目标工具 profile：不同 AI 编码工具对提示词结构的偏好差异。
// PromptGenerator 依据这些布尔/枚举字段在 Markdown 输出上叠加结构适配。

/** 支持的目标工具（generic = 现状，不做任何适配） */
export type TargetTool = 'generic' | 'claude-code' | 'cursor' | 'copilot' | 'codex';

/** 目标工具 profile 配置：结构差异用布尔字段表达，供生成器消费 */
export interface TargetToolProfile {
  id: TargetTool;
  /** 中文展示名 */
  label: string;
  /** 一句话说明适配点 */
  description: string;
  /** 主要分段用 XML 标签包裹（<context>/<task>/<spec>/<constraints>/<acceptance_criteria>），适配 Claude Code */
  useXmlTags?: boolean;
  /** 含「相关文件」占位段，适配 Cursor */
  includeFilePathHints?: boolean;
  /** 含任务分步（执行步骤编号段） */
  includeTaskBreakdown?: boolean;
  /** 含停止条件段，适配 Cursor */
  includeStopConditions?: boolean;
  /** 规格化段落（目标/输入/输出/约束/验收标准），适配 Codex */
  useStructuredSpec?: boolean;
}

/** 5 个工具的 profile 常量 */
export const TARGET_TOOL_PROFILES: Record<TargetTool, TargetToolProfile> = {
  generic: {
    id: 'generic',
    label: '通用',
    description: '标准四段结构提示词，不针对特定工具做适配',
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    description: '主要分段用 XML 标签包裹，便于结构化解析任务与约束',
    useXmlTags: true,
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    description: '附相关文件占位、任务分步与停止条件段，贴合编辑器内工作流',
    includeFilePathHints: true,
    includeTaskBreakdown: true,
    includeStopConditions: true,
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    description: '结尾附简洁执行步骤，适配补全场景的短上下文习惯',
    includeTaskBreakdown: true,
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    description: '输出目标/输入/输出/约束/验收标准的规格化段落',
    useStructuredSpec: true,
  },
};

/** 供 UI 渲染下拉/选项用 */
export const TARGET_TOOL_OPTIONS: Array<{ value: TargetTool; label: string; description: string }> = (
  Object.keys(TARGET_TOOL_PROFILES) as TargetTool[]
).map((key) => {
  const { id, label, description } = TARGET_TOOL_PROFILES[key];
  return { value: id, label, description };
});
