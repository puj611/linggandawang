// src/mcp-server.test.ts
// MCP server（Task 15/16）单测：不走真子进程，直接测协议层 handleJsonRpc
// 与工具层输出（vitest 走 vite 管线，可解析引擎侧 *.yaml?raw 导入与 @ 别名）。
// 真子进程 stdio 冒烟见 mcp-server/smoke-test.mjs（需先 vite build）。
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROTOCOL_VERSION, SERVER_INFO, handleJsonRpc } from '../mcp-server/protocol';
import type { JsonRpcResponse } from '../mcp-server/protocol';

const SEED_FRONTEND = '给登录页加表单校验';
const SEED_BACKEND = '写一个用户登录接口，返回 JWT';
const SEED_PPT = '帮我做一份季度汇报 PPT';

async function rpc(method: string, params?: unknown, id: number | string = 1): Promise<JsonRpcResponse> {
  const res = await handleJsonRpc({ jsonrpc: '2.0', id, method, params });
  expect(res).not.toBeNull();
  return res!;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}> {
  const res = await rpc('tools/call', { name, arguments: args });
  expect(res.error).toBeUndefined();
  return res.result as Awaited<ReturnType<typeof callTool>>;
}

describe('MCP 协议层（JSON-RPC 2.0）', () => {
  it('initialize 返回 serverInfo / capabilities / 协议版本', async () => {
    const res = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    const result = res.result as {
      protocolVersion: string;
      capabilities: { tools: unknown };
      serverInfo: { name: string; version: string };
    };
    // 回显客户端请求的协议版本，保持兼容
    expect(result.protocolVersion).toBe('2025-03-26');
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe(SERVER_INFO.name);
  });

  it('initialize 未传版本时回退默认协议版本', async () => {
    const res = await rpc('initialize', {});
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION);
  });

  it('ping 返回空结果', async () => {
    const res = await rpc('ping');
    expect(res.result).toEqual({});
  });

  it('tools/list 返回两个工具且 schema 完整', async () => {
    const res = await rpc('tools/list');
    const tools = (res.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(['generate_prompt', 'list_questions']);
    for (const tool of tools) {
      const schema = tool.inputSchema as { type: string; required?: string[] };
      expect(schema.type).toBe('object');
      expect(schema.required).toContain('seed');
      expect(typeof tool.description).toBe('string');
    }
  });

  it('notifications/* 与未知 notification 不产生响应', async () => {
    expect(await handleJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(
      await handleJsonRpc({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }),
    ).toBeNull();
  });

  it('未知 method 的请求返回 -32601', async () => {
    const res = await rpc('resources/list');
    expect(res.error?.code).toBe(-32601);
  });

  it('非法消息返回 -32600', async () => {
    const res = await handleJsonRpc({ foo: 'bar' });
    expect(res?.error?.code).toBe(-32600);
  });
});

describe('MCP 工具：list_questions', () => {
  it('前端 seed 路由到 frontend-ui 且返回非空问题列表', async () => {
    const result = await callTool('list_questions', { seed: SEED_FRONTEND });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      scene: string;
      questions: Array<{ id: string; text: string; options: Array<{ value: string; label: string }> }>;
    };
    expect(structured.scene).toBe('frontend-ui');
    expect(structured.questions.length).toBeGreaterThan(0);
    for (const q of structured.questions) {
      expect(q.id).toBeTruthy();
      expect(q.text).toBeTruthy();
      expect(Array.isArray(q.options)).toBe(true);
    }
    // 文本内容为 JSON（供不支持 structuredContent 的客户端读取）
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.questions.length).toBe(structured.questions.length);
  });

  it('后端 seed 路由到 backend-api', async () => {
    const result = await callTool('list_questions', { seed: SEED_BACKEND });
    expect((result.structuredContent as { scene: string }).scene).toBe('backend-api');
  });

  it('PPT seed 路由到 ppt', async () => {
    const result = await callTool('list_questions', { seed: SEED_PPT });
    expect((result.structuredContent as { scene: string }).scene).toBe('ppt');
  });

  it('显式 scene 覆盖自动检测', async () => {
    const result = await callTool('list_questions', { seed: SEED_FRONTEND, scene: 'ppt' });
    expect((result.structuredContent as { scene: string }).scene).toBe('ppt');
  });

  it('seed 缺失返回工具级错误 isError', async () => {
    const result = await callTool('list_questions', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('seed');
  });

  it('非法 scene 返回工具级错误', async () => {
    const result = await callTool('list_questions', { seed: 'x', scene: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('scene');
  });
});

describe('MCP 工具：generate_prompt', () => {
  it('无 answers：默认推荐选项策略生成非空 markdown，含 seed 与四段结构', async () => {
    const result = await callTool('generate_prompt', { seed: SEED_FRONTEND });
    expect(result.isError).toBeUndefined();
    const md = result.content[0].text;
    expect(md.length).toBeGreaterThan(100);
    // 动作段必含 seed 原文（「校验」相关内容）
    expect(md).toContain('校验');
    expect(md).toContain('给登录页加表单校验');
    // 四段结构
    expect(md).toContain('# 你的提示词');
    expect(md).toContain('## 1. 要做什么');
    expect(md).toContain('## 2. 怎么做');
    expect(md).toContain('## 3. 不能怎么');
    expect(md).toContain('## 4. 怎么算做好了');
    expect((result.structuredContent as { scene: string }).scene).toBe('frontend-ui');
  });

  it('target_tool=claude-code：分段被 XML 标签包裹', async () => {
    const result = await callTool('generate_prompt', {
      seed: SEED_FRONTEND,
      target_tool: 'claude-code',
    });
    const md = result.content[0].text;
    expect(md).toContain('<task>');
    expect(md).toContain('</task>');
  });

  it('target_tool=cursor：包含相关文件与执行步骤段', async () => {
    const result = await callTool('generate_prompt', {
      seed: SEED_FRONTEND,
      target_tool: 'cursor',
    });
    const md = result.content[0].text;
    expect(md).toContain('## 相关文件');
    expect(md).toContain('## 执行步骤');
  });

  it('传入 answers（选项 value）可改变输出且不报错', async () => {
    // 先取问题列表，选一道选择题的非默认选项回答
    const listed = await callTool('list_questions', { seed: SEED_FRONTEND });
    const questions = (listed.structuredContent as {
      questions: Array<{ id: string; options: Array<{ value: string; label: string }> }>;
    }).questions;
    const choice = questions.find((q) => q.options.length >= 2);
    expect(choice).toBeDefined();

    const answers: Record<string, string> = { [choice!.id]: choice!.options[1].value };
    const withDefault = await callTool('generate_prompt', { seed: SEED_FRONTEND });
    const withAnswer = await callTool('generate_prompt', { seed: SEED_FRONTEND, answers });
    expect(withAnswer.isError).toBeUndefined();
    expect(withAnswer.content[0].text.length).toBeGreaterThan(100);
    // 用户答案应出现在原话引用中（raw_quote → 「<!-- 原话：label -->」）
    expect(withAnswer.content[0].text).toContain(choice!.options[1].label);
    expect(withAnswer.content[0].text).not.toBe(withDefault.content[0].text);
  });

  it('传入自定义文本 answers 视为自由回答', async () => {
    const result = await callTool('generate_prompt', {
      seed: SEED_FRONTEND,
      answers: { 'p-999-not-exist': '自由文本答案' },
    });
    // 不存在的问题 id 被忽略，仍正常生成
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('# 你的提示词');
  });

  it('后端 seed 生成 backend-api 场景提示词', async () => {
    const result = await callTool('generate_prompt', { seed: SEED_BACKEND });
    expect((result.structuredContent as { scene: string }).scene).toBe('backend-api');
    expect(result.content[0].text).toContain('# 你的提示词');
  });

  it('非法 target_tool 返回工具级错误', async () => {
    const result = await callTool('generate_prompt', { seed: 'x', target_tool: 'vim' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('target_tool');
  });
});

describe('MCP tools/call 协议错误', () => {
  it('未知工具名返回 -32602', async () => {
    const res = await rpc('tools/call', { name: 'no_such_tool', arguments: {} });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('no_such_tool');
  });
});
