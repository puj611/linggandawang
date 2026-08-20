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

const SCENE_CHOICES: SceneChoice[] = ['auto', 'frontend-ui', 'backend-api', 'ppt'];
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

/** tools/call 分发器：未知工具名抛 UnknownToolError 由协议层转 -32602 */
export function callToolByName(name: string, args: Record<string, unknown>): McpToolResult {
  if (name !== 'list_questions' && name !== 'generate_prompt') {
    throw new UnknownToolError(`未知工具「${name}」，可用工具：${TOOL_DEFINITIONS.map((t) => t.name).join(' | ')}`);
  }
  try {
    return name === 'list_questions'
      ? listQuestions(args as unknown as ListQuestionsInput)
      : generatePrompt(args as unknown as GeneratePromptInput);
  } catch (e) {
    if (e instanceof ToolError) {
      // 参数/用法错误：工具级错误（isError），让调用方 LLM 能读到原因并自行修正
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
    throw e;
  }
}
