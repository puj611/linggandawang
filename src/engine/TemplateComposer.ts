// src/engine/TemplateComposer.ts
// 变量模板组合器（R05）：解析 {{变量}} 占位符、类型推断、缺参校验与填充生成。
// 纯业务逻辑，不依赖 Tauri API / React，可独立测试。
// 仅支持 {{ }} 语法，不支持表达式（路线图风险对策：复杂语法不做）。

/** 变量类型提示（MVP 两档：文本/数字；枚举留给后续版本） */
export type VariableType = 'text' | 'number';

/** 用户模板（engine 层形状；持久化由 lib/templateStore 负责，存字符串字段） */
export interface UserTemplate {
  id: string;
  name: string;
  /** 模板正文，可含 {{变量}} 占位符 */
  body: string;
  /** 分类标签（去重、去空白） */
  tags: string[];
  /** 解析出的变量名列表（保存时快照，展示用；使用时以 body 实时解析为准） */
  vars: string[];
  createdAt: string;
  updatedAt: string;
}

/** 新建模板的输入（id 与时间戳由存储层生成） */
export type UserTemplateInput = Pick<UserTemplate, 'name' | 'body' | 'tags'>;

/** {{变量}} 占位符匹配（容忍内侧空格：{{ name }}，变量名内不允许花括号） */
const VAR_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * 解析模板正文中的变量名，按出现顺序去重。
 * 空名（{{{ }}} 或 {{}} 内全空白）忽略。
 */
export function parseTemplateVariables(body: string): string[] {
  const seen = new Set<string>();
  const vars: string[] = [];
  for (const m of body.matchAll(VAR_PATTERN)) {
    const name = m[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      vars.push(name);
    }
  }
  return vars;
}

/** 数字类关键词：命中任一推断为 number，其余 text */
const NUMBER_HINT = /(数量|条数|次数|宽度|高度|长度|字号|间距|圆角|num|count|size|width|height|px|radius)/i;

/**
 * 按变量名推断类型提示：数字类变量在 UI 用数字键盘输入框。
 * 推断仅是提示，不强制校验（模板变量本质都是文本替换）。
 */
export function inferVariableType(name: string): VariableType {
  return NUMBER_HINT.test(name) ? 'number' : 'text';
}

/** 填参结果：缺参时 ok=false 并给出缺失变量名列表（按模板出现顺序） */
export interface ComposeResult {
  ok: boolean;
  /** 填充完成的完整提示词；缺参时为空串 */
  text: string;
  /** 缺失（空值或未提供）的变量名 */
  missing: string[];
}

/**
 * 校验并填充模板：所有变量都有非空白值才允许生成（缺参禁止生成）。
 * 值本身不做二次模板展开（不支持嵌套 {{}}）。
 */
export function composePrompt(body: string, values: Record<string, string>): ComposeResult {
  const vars = parseTemplateVariables(body);
  const missing = vars.filter((v) => {
    const val = values[v];
    return typeof val !== 'string' || val.trim() === '';
  });
  if (missing.length > 0) {
    return { ok: false, text: '', missing };
  }
  const text = body.replace(VAR_PATTERN, (_all, name: string) => values[name.trim()]);
  return { ok: true, text, missing: [] };
}

/**
 * 构造模板（保存前）：名称去空白兜底、标签去重去空白、变量快照。
 * 不生成 id/时间戳（由存储层负责）。
 */
export function buildUserTemplate(input: UserTemplateInput): UserTemplateInput & { vars: string[] } {
  const tags = Array.from(
    new Set(input.tags.map((t) => t.trim()).filter(Boolean)),
  );
  return {
    name: input.name.trim() || '未命名模板',
    body: input.body,
    tags,
    vars: parseTemplateVariables(input.body),
  };
}
