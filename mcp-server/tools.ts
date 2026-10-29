// mcp-server/tools.ts
// MCP 工具层：把问题库引导式提示词生成引擎包装为两个 MCP 工具
//   1. list_questions  —— 预览 seed 路由后将被提问的问题列表
//   2. generate_prompt —— 一次性生成结构化 markdown 提示词
// 依赖隔离说明：只使用引擎的纯逻辑部分（QuestionEngine / seedRouter / PromptGenerator），
// 不触发 LLM 意图分析（llmAnalysis 传 null），不依赖 Tauri 运行时，无网络调用，免 API key。
import { QuestionEngine } from '../src/engine/QuestionEngine';
import { QuestionLoader } from '../src/engine/QuestionLoader';
import { PromptGenerator } from '../src/engine/PromptGenerator';
import { TARGET_TOOL_PROFILES } from '../src/engine/targetToolProfiles';
import type { TargetTool } from '../src/engine/targetToolProfiles';
import type { Question, SceneChoice } from '../src/engine/types';
import { readContext, readHistory, readTemplates } from './localData';

/** MCP 工具入参约定 */
export interface ListQuestionsInput {
  seed: string;
  scene?: string;
}

export interface GeneratePromptInput {
  seed: string;
  target_tool?: string;
  scene?: string;
  answers?: Record<string, string>;
}

export interface GenerateFromContextInput {
  /** 代码片段 / 报错日志 / 文件路径，作为需求的原始上下文 */
  context: string;
  /** 可选：补充说明，说明想让 AI 做什么 */
  goal?: string;
  context_type?: string;
  target_tool?: string;
  scene?: string;
  answers?: Record<string, string>;
}

export interface ListTemplatesInput {
  /** 按名称/正文/标签做子串过滤（大小写不敏感） */
  query?: string;
  limit?: number;
}

export interface GetRecentHistoryInput {
  limit?: number;
  favorite_only?: boolean;
  /** 是否返回完整 markdown（默认 false，只返回标题与摘要，避免刷屏） */
  include_markdown?: boolean;
}

const SCENE_CHOICES: SceneChoice[] = ['auto', 'frontend-ui', 'backend-api', 'ppt'];
const CONTEXT_TYPES = ['error', 'code', 'path', 'other'];
const TARGET_TOOLS = Object.keys(TARGET_TOOL_PROFILES) as TargetTool[];

/** 推进安全阀：jump 规则理论上成环时防止死循环 */
const MAX_STEPS = 200;

/** 工具级错误（isError: true 返回给调用方，而非协议层错误） */
export class ToolError extends Error {}

/** 未知工具名（协议层错误 -32602，与 MCP 官方 SDK 行为一致） */
export class UnknownToolError extends Error {}

function normalizeScene(scene: string | undefined): SceneChoice {
  if (!scene) return 'auto';
  if (!SCENE_CHOICES.includes(scene as SceneChoice)) {
    throw new ToolError(`无效的 scene「${scene}」，可选值：${SCENE_CHOICES.join(' | ')}`);
  }
  return scene as SceneChoice;
}

function normalizeTargetTool(tool: string | undefined): TargetTool {
  if (!tool) return 'generic';
  if (!TARGET_TOOLS.includes(tool as TargetTool)) {
    throw new ToolError(`无效的 target_tool「${tool}」，可选值：${TARGET_TOOLS.join(' | ')}`);
  }
  return tool as TargetTool;
}

function requireSeed(seed: unknown): string {
  if (typeof seed !== 'string' || seed.trim().length === 0) {
    throw new ToolError('seed（需求描述）不能为空');
  }
  return seed.trim();
}

function normalizeAnswers(answers: unknown): Record<string, string> | undefined {
  if (answers === undefined || answers === null) return undefined;
  if (typeof answers !== 'object' || Array.isArray(answers)) {
    throw new ToolError('answers 必须是「问题 id → 答案文本」的对象');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 以「默认推荐选项」策略推进引擎到 COMPLETE：
 *   - 调用方传了 answers 的题 → 按用户答案提交（匹配选项 value，否则视为自由文本）
 *   - 未传答案的选择题 → 默认选第一选项（引擎的推荐项）
 *   - 未传答案的开放题 → 跳过
 * 返回推进过程中被问到的问题（按提问顺序）。
 */
function runEngineWithDefaults(
  seed: string,
  sceneChoice: SceneChoice,
  userAnswers?: Record<string, string>,
): { engine: QuestionEngine; asked: Question[] } {
  const loader = new QuestionLoader();
  const engine = new QuestionEngine(loader);
  engine.start(seed, 'full', null, undefined, sceneChoice);

  const asked: Question[] = [];
  let guard = 0;
  while (engine.currentQuestion() !== null && guard < MAX_STEPS) {
    guard += 1;
    const q = engine.currentQuestion()!;
    asked.push(q);

    const userValue = userAnswers?.[q.id];
    if (userValue !== undefined && userValue !== '') {
      applyUserAnswer(engine, q, userValue);
    } else if (q.options.length > 0) {
      const opt = q.options[0];
      engine.answer(opt.value, opt.label, opt.tags);
    } else {
      engine.skip();
    }
  }
  return { engine, asked };
}

/** 提交用户答案：优先匹配选项 value；multi-choice 支持逗号分隔多选；否则视为自定义文本 */
function applyUserAnswer(engine: QuestionEngine, q: Question, userValue: string): void {
  const values = userValue
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const matched = values
    .map((v) => q.options.find((o) => o.value === v))
    .filter((o): o is NonNullable<typeof o> => o !== undefined);

  if (matched.length > 0) {
    const joined = matched.map((o) => o.value).join(',');
    engine.answer(joined, matched.map((o) => o.label).join(' / '), matched.flatMap((o) => o.tags));
  } else {
    engine.answer(userValue, userValue, []);
  }
}

/** tools/list 返回的工具定义（JSON Schema 手写，不依赖 zod） */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_questions',
    description:
      '根据需求描述（seed）用规则引擎路由问题库，返回本次将被提问的问题列表（id、题面、选项）。' +
      '可选 scene 指定场景（auto=关键词自动检测 / frontend-ui / backend-api / ppt）。' +
      '用于在生成提示词前预览问题，或决定要通过 answers 回答哪些问题。免 API key，纯本地规则。',
    inputSchema: {
      type: 'object',
      properties: {
        seed: { type: 'string', description: '需求描述/灵感种子，如「给登录页加表单校验」' },
        scene: {
          type: 'string',
          enum: SCENE_CHOICES,
          default: 'auto',
          description: '场景选择，auto 表示按关键词自动检测',
        },
      },
      required: ['seed'],
    },
  },
  {
    name: 'generate_prompt',
    description:
      '把模糊需求描述（seed）挤成精准的结构化 markdown 提示词（动作/规格/约束/验证四段）。' +
      '内部走规则引擎自动路由问题：未通过 answers 提供的答案一律采用每题默认推荐选项（第一选项）。' +
      '可先调用 list_questions 获取问题列表，再用 answers（问题 id → 选项 value 或自由文本）精准控制。' +
      'target_tool 可按目标 AI 编码工具（claude-code/cursor/copilot/codex）做结构适配。免 API key，无网络调用。',
    inputSchema: {
      type: 'object',
      properties: {
        seed: { type: 'string', description: '需求描述/灵感种子' },
        target_tool: {
          type: 'string',
          enum: TARGET_TOOLS,
          default: 'generic',
          description: '目标 AI 编码工具，决定提示词结构适配（XML 标签/相关文件段/规格化段落等）',
        },
        scene: {
          type: 'string',
          enum: SCENE_CHOICES,
          default: 'auto',
          description: '场景选择，auto 表示按关键词自动检测',
        },
        answers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            '可选。问题 id → 答案（选项 value 或自由文本；multi-choice 可用逗号分隔多选）。' +
            '先用 list_questions 获取问题 id 与选项 value',
        },
      },
      required: ['seed'],
    },
  },
  {
    name: 'generate_from_context',
    description:
      '直接拿代码片段 / 报错日志 / 文件路径作为上下文生成提示词，不必先自己总结成需求描述。' +
      '适用于「贴一段报错问 AI」「给个文件路径让它改」这类场景：本工具会把上下文与目标拼成 seed 再走同一套提问引擎。' +
      'context_type 影响拼接措辞（error/code/path/other）。免 API key，无网络调用。',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: '原始上下文：完整报错栈、代码片段、或文件路径（多行可用 \\n）',
        },
        goal: {
          type: 'string',
          description: '可选。想让 AI 做什么，如「修掉这个报错」「给这个文件加类型注解」',
        },
        context_type: {
          type: 'string',
          enum: CONTEXT_TYPES,
          default: 'other',
          description: '上下文类型，决定拼接措辞',
        },
        target_tool: {
          type: 'string',
          enum: TARGET_TOOLS,
          default: 'generic',
          description: '目标 AI 编码工具',
        },
        scene: {
          type: 'string',
          enum: SCENE_CHOICES,
          default: 'auto',
          description: '场景选择',
        },
        answers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: '可选。问题 id → 答案，同 generate_prompt',
        },
      },
      required: ['context'],
    },
  },
  {
    name: 'list_templates',
    description:
      '列出用户在灵感大王桌面端保存的变量模板（含 {{变量}} 占位符的提示词）。' +
      '可用 query 按名称/正文/标签子串过滤。需要桌面端至少运行过一次并有保存过模板；' +
      '数据不存在时返回空列表并说明原因（不是错误）。只读，不修改用户数据。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '可选。按名称/正文/标签做子串过滤（大小写不敏感）' },
        limit: { type: 'number', description: '返回条数上限，默认 20，最大 100' },
      },
    },
  },
  {
    name: 'get_recent_history',
    description:
      '读取用户在灵感大王桌面端生成的提示词历史（最近 N 条），可用于复用/参考过往提示词风格。' +
      '默认只返回标题与摘要，include_markdown=true 才返回完整正文。' +
      'favorite_only=true 只看收藏。数据不存在时返回空列表并说明原因。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数上限，默认 10，最大 50' },
        favorite_only: { type: 'boolean', default: false, description: '只看已收藏的记录' },
        include_markdown: { type: 'boolean', default: false, description: '是否返回完整 markdown 正文' },
      },
    },
  },
];

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function textResult(text: string, structured?: Record<string, unknown>): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** list_questions 工具实现 */
export function listQuestions(input: ListQuestionsInput): McpToolResult {
  const seed = requireSeed(input.seed);
  const sceneChoice = normalizeScene(input.scene);
  const { engine, asked } = runEngineWithDefaults(seed, sceneChoice);

  const questions = asked.map((q) => ({
    id: q.id,
    stage: q.stage,
    type: q.type,
    text: q.text,
    allow_custom: q.allow_custom,
    options: q.options.map((o) => ({ value: o.value, label: o.label })),
    ...(q.why ? { why: q.why } : {}),
  }));
  const structured = {
    scene: engine.getScene(),
    route_source: engine.getRouteSource(),
    matched_keywords: engine.getMatchedKeywords(),
    total: questions.length,
    questions,
  };
  return textResult(JSON.stringify(structured, null, 2), structured);
}

/** generate_prompt 工具实现 */
export function generatePrompt(input: GeneratePromptInput): McpToolResult {
  const seed = requireSeed(input.seed);
  const sceneChoice = normalizeScene(input.scene);
  const targetTool = normalizeTargetTool(input.target_tool);
  const answers = normalizeAnswers(input.answers);

  const { engine } = runEngineWithDefaults(seed, sceneChoice, answers);

  const generator = new PromptGenerator();
  const result = generator.generate({
    intentTags: engine.getIntentTags(),
    answers: engine.getAnswers(),
    seedInput: seed,
    mode: 'quick',
    scene: engine.getScene(),
    questionStageMap: engine.getQuestionStageMap(),
    targetTool,
  });
  const markdown = generator.toMarkdown(result);
  const structured = {
    markdown,
    scene: engine.getScene(),
    target_tool: targetTool,
    route_source: engine.getRouteSource(),
  };
  return textResult(markdown, structured);
}


/** 把上下文与目标拼成可读的 seed（不依赖 LLM，纯字符串拼装） */
function composeContextSeed(context: string, goal: string | undefined, contextType: string): string {
  const body = context.trim();
  const goalText = goal?.trim();
  const prefix: Record<string, string> = {
    error: '修复以下报错',
    code: '基于以下代码',
    path: '修改以下文件',
    other: '基于以下上下文',
  };
  const head = prefix[contextType] ?? prefix.other;
  const action = goalText ? `：${goalText}` : '';
  return `${head}${action}\n\n${body}`;
}

/** generate_from_context 工具实现 */
export function generateFromContext(input: GenerateFromContextInput): McpToolResult {
  if (typeof input.context !== 'string' || input.context.trim().length === 0) {
    throw new ToolError('context（代码/报错/路径）不能为空');
  }
  const contextType = input.context_type ?? 'other';
  if (!CONTEXT_TYPES.includes(contextType)) {
    throw new ToolError(`无效的 context_type「${contextType}」，可选值：${CONTEXT_TYPES.join(' | ')}`);
  }
  const seed = composeContextSeed(input.context, input.goal, contextType);
  const result = generatePrompt({
    seed,
    target_tool: input.target_tool,
    scene: input.scene,
    answers: input.answers,
  });
  // 在结构化结果上补 context 元信息，便于调用方确认拼接是否正确
  if (result.structuredContent) {
    result.structuredContent = {
      ...result.structuredContent,
      context_type: contextType,
      context_chars: input.context.length,
      composed_seed_chars: seed.length,
    };
  }
  return result;
}

/** list_templates 工具实现 */
export function listTemplatesTool(input: ListTemplatesInput): McpToolResult {
  const rawLimit = typeof input.limit === 'number' ? input.limit : 20;
  const limit = Math.min(Math.max(1, Math.floor(rawLimit)), 100);
  const q = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';

  let all = readTemplates();
  const totalBeforeFilter = all.length;
  if (q) {
    all = all.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }
  const items = all.slice(0, limit).map((t) => ({
    id: t.id,
    name: t.name,
    tags: t.tags,
    body: t.body,
    updated_at: t.updated_at,
  }));

  const structured: Record<string, unknown> = {
    total_in_store: totalBeforeFilter,
    matched: all.length,
    returned: items.length,
    items,
  };
  if (totalBeforeFilter === 0) {
    structured.note =
      '本机没有已保存的模板。需要先在灵感大王桌面端「存为模板」；本工具只读，不能创建模板。';
  }
  return textResult(JSON.stringify(structured, null, 2), structured);
}

/** get_recent_history 工具实现 */
export function getRecentHistoryTool(input: GetRecentHistoryInput): McpToolResult {
  const rawLimit = typeof input.limit === 'number' ? input.limit : 10;
  const limit = Math.min(Math.max(1, Math.floor(rawLimit)), 50);
  const favoriteOnly = input.favorite_only === true;
  const includeMarkdown = input.include_markdown === true;

  const rows = readHistory(limit, favoriteOnly);
  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    seed_input: r.seed_input,
    favorite: r.favorite,
    created_at: r.created_at,
    ...(includeMarkdown
      ? { markdown: r.markdown }
      : { excerpt: r.markdown.length > 160 ? r.markdown.slice(0, 160) + '…' : r.markdown }),
  }));

  // 附带桌面端维护的问答上下文，让调用方了解用户当前在做什么（只取最近 5 条，避免刷屏）
  const ctx = readContext();
  const recentQA = ctx.recent_qa.slice(-5).map((qa) => ({
    question_text: qa.question_text,
    answer: qa.answer,
  }));

  const structured: Record<string, unknown> = {
    favorite_only: favoriteOnly,
    include_markdown: includeMarkdown,
    returned: items.length,
    items,
    ...(recentQA.length > 0 ? { recent_qa: recentQA } : {}),
    ...(ctx.project ? { project: ctx.project } : {}),
    ...(ctx.preferences.length > 0 ? { preferences: ctx.preferences } : {}),
  };
  if (rows.length === 0) {
    structured.note = favoriteOnly
      ? '没有已收藏的提示词历史。'
      : '本机还没有提示词历史。需要先在灵感大王桌面端生成过提示词；本工具只读。';
  }
  return textResult(JSON.stringify(structured, null, 2), structured);
}

/** tools/call 分发器：未知工具名抛 UnknownToolError 由协议层转 -32602 */
export function callToolByName(name: string, args: Record<string, unknown>): McpToolResult {
  const handlers: Record<string, (a: Record<string, unknown>) => McpToolResult> = {
    list_questions: (a) => listQuestions(a as unknown as ListQuestionsInput),
    generate_prompt: (a) => generatePrompt(a as unknown as GeneratePromptInput),
    generate_from_context: (a) => generateFromContext(a as unknown as GenerateFromContextInput),
    list_templates: (a) => listTemplatesTool(a as unknown as ListTemplatesInput),
    get_recent_history: (a) => getRecentHistoryTool(a as unknown as GetRecentHistoryInput),
  };
  const handler = handlers[name];
  if (!handler) {
    throw new UnknownToolError(
      `未知工具「${name}」，可用工具：${TOOL_DEFINITIONS.map((t) => t.name).join(' | ')}`,
    );
  }
  try {
    return handler(args);
  } catch (e) {
    if (e instanceof ToolError) {
      // 参数/用法错误：工具级错误（isError），让调用方 LLM 能读到原因并自行修正
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
    throw e;
  }
}
