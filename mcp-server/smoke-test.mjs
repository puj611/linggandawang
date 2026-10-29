#!/usr/bin/env node
// mcp-server/smoke-test.mjs
// MCP server 真子进程 stdio 冒烟测试（Task 16.2）：
//   spawn mcp-server/dist/index.js，走完整 JSON-RPC 握手：
//   initialize → notifications/initialized → tools/list → tools/call（generate_prompt / list_questions）
// 断言：
//   1. stdout 每一行都是合法 JSON（协议通道纯净，无日志污染）
//   2. generate_prompt 对「给登录页加表单校验」返回非空 markdown 且含「校验」
// 运行（先构建）：node mcp-server/smoke-test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, 'dist', 'index.js');

const SEED = '给登录页加表单校验';

function rpcRequest(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function rpcNotification(method, params) {
  return JSON.stringify({ jsonrpc: '2.0', method, params });
}

function assert(cond, message) {
  if (!cond) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${message}`);
  }
}

async function waitFor(map, id, timeoutMs = 15000) {
  const start = Date.now();
  while (!map.has(id)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待响应 id=${id} 超时（${timeoutMs}ms）`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return map.get(id);
}

async function main() {
  const proc = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = new Map();
  const nonJsonLines = [];
  let stderrText = '';

  proc.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.id !== null) {
          responses.set(msg.id, msg);
        }
      } catch {
        nonJsonLines.push(line);
      }
    }
  });
  proc.stderr.on('data', (d) => {
    stderrText += d.toString();
  });

  // 握手 + 通知 + 工具列表（可并发）
  proc.stdin.write(rpcRequest(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.1' },
  }) + '\n');
  proc.stdin.write(rpcNotification('notifications/initialized') + '\n');
  proc.stdin.write(rpcRequest(2, 'tools/list') + '\n');

  // 工具调用逐个串行发送：list_questions 返回 ~24KB 文本，
  // 一次性连发多条会让响应在同一个 chunk 里堆积，等待逻辑容易误判超时。
  const CALLS = [
    [3, 'generate_prompt', { seed: SEED }],
    [4, 'list_questions', { seed: SEED }],
    [5, 'generate_from_context', {
      context: 'TypeError: Cannot read properties of undefined (reading \'map\')\n    at renderList (List.tsx:42)',
      goal: '修掉这个报错',
      context_type: 'error',
    }],
    [6, 'list_templates', {}],
    [7, 'get_recent_history', { limit: 3 }],
    // 负例：未知工具应返回协议层错误 -32602
    [8, 'no_such_tool', {}],
  ];
  for (const [id, name, args] of CALLS) {
    proc.stdin.write(rpcRequest(id, 'tools/call', { name, arguments: args }) + '\n');
    // 给每条调用留出处理时间，避免堆积
    await new Promise((r) => setTimeout(r, 120));
  }

  try {
    const init = await waitFor(responses, 1);
    assert(
      init.result?.serverInfo?.name === 'linggandawang',
      `initialize 返回 serverInfo=${init.result?.serverInfo?.name} / 协议版本=${init.result?.protocolVersion}`,
    );

    const tools = await waitFor(responses, 2);
    const toolNames = (tools.result?.tools ?? []).map((t) => t.name).sort();
    const EXPECTED_TOOLS = [
      'generate_from_context',
      'generate_prompt',
      'get_recent_history',
      'list_questions',
      'list_templates',
    ];
    assert(
      JSON.stringify(toolNames) === JSON.stringify(EXPECTED_TOOLS),
      `tools/list 返回 5 个工具：${toolNames.join(', ')}`,
    );
    // 每个工具都必须有非空 description 与合法 inputSchema，否则 Agent 无法正确选择
    for (const t of tools.result?.tools ?? []) {
      assert(
        typeof t.description === 'string' && t.description.length > 20,
        `${t.name} 有可读 description（${t.description?.length ?? 0} 字符）`,
      );
      assert(
        t.inputSchema?.type === 'object',
        `${t.name} inputSchema 为 object`,
      );
    }

    const gen = await waitFor(responses, 3);
    const markdown = gen.result?.content?.[0]?.text ?? '';
    assert(gen.result?.isError !== true, 'generate_prompt 未返回工具级错误');
    assert(markdown.length > 100, `generate_prompt 返回非空 markdown（${markdown.length} 字符）`);
    assert(markdown.includes('校验'), 'markdown 含「校验」相关内容（动作段含 seed 原文）');
    assert(markdown.includes('# 你的提示词'), 'markdown 含四段结构标题「# 你的提示词」');
    assert(markdown.includes('## 4. 怎么算做好了'), 'markdown 含验证段「## 4. 怎么算做好了」');

    const list = await waitFor(responses, 4);
    const questions = list.result?.structuredContent?.questions ?? [];
    assert(questions.length > 0, `list_questions 返回 ${questions.length} 个问题（scene=${list.result?.structuredContent?.scene}）`);

    // generate_from_context：应把报错上下文拼进 seed 并生成提示词
    const fromCtx = await waitFor(responses, 5);
    const ctxMd = fromCtx.result?.content?.[0]?.text ?? '';
    assert(fromCtx.result?.isError !== true, 'generate_from_context 未返回工具级错误');
    assert(ctxMd.length > 100, `generate_from_context 返回非空 markdown（${ctxMd.length} 字符）`);
    assert(
      ctxMd.includes('TypeError') || ctxMd.includes('renderList'),
      'markdown 含报错上下文原文（未丢失）',
    );
    const ctxMeta = fromCtx.result?.structuredContent ?? {};
    assert(ctxMeta.context_type === 'error', `context_type 回传为 error（实际=${ctxMeta.context_type}）`);
    assert(
      typeof ctxMeta.composed_seed_chars === 'number' && ctxMeta.composed_seed_chars > 0,
      `composed_seed_chars 回传（${ctxMeta.composed_seed_chars}）`,
    );

    // list_templates：无数据时应是空列表 + note，而不是错误
    const tpl = await waitFor(responses, 6);
    assert(tpl.result?.isError !== true, 'list_templates 未返回工具级错误（无数据是正常态）');
    const tplData = tpl.result?.structuredContent ?? {};
    assert(Array.isArray(tplData.items), 'list_templates 返回 items 数组');
    assert(
      typeof tplData.total_in_store === 'number',
      `list_templates 回传 total_in_store（${tplData.total_in_store}）`,
    );
    if (tplData.total_in_store === 0) {
      assert(typeof tplData.note === 'string', 'list_templates 空数据时给出 note 说明');
    }

    // get_recent_history：同上
    const hist = await waitFor(responses, 7);
    assert(hist.result?.isError !== true, 'get_recent_history 未返回工具级错误');
    const histData = hist.result?.structuredContent ?? {};
    assert(Array.isArray(histData.items), 'get_recent_history 返回 items 数组');
    assert(
      histData.include_markdown === false,
      'get_recent_history 默认不返回完整 markdown',
    );

    // 未知工具：协议层错误 -32602
    const unknown = await waitFor(responses, 8);
    assert(
      unknown.error?.code === -32602,
      `未知工具返回 -32602（实际=${unknown.error?.code ?? 'no error'}）`,
    );

    assert(nonJsonLines.length === 0, `stdout 协议纯净（非 JSON 行数=${nonJsonLines.length}）`);
  } catch (e) {
    console.error(`✗ 冒烟测试失败: ${e.message}`);
    if (stderrText) console.error('---- server stderr ----\n' + stderrText);
    process.exitCode = 1;
  } finally {
    proc.kill();
  }

  // 打印生成结果片段（证据）
  const gen = responses.get(3);
  if (gen?.result?.content?.[0]?.text) {
    const md = gen.result.content[0].text;
    console.log('\n---- generate_prompt 输出片段（前 600 字符）----');
    console.log(md.slice(0, 600));
    console.log('---- 片段结束 ----');
  }
}

await main();
