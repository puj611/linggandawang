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

  // 依次发送：握手 → 通知 → 工具列表 → 两个工具调用
  proc.stdin.write(rpcRequest(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.1' },
  }) + '\n');
  proc.stdin.write(rpcNotification('notifications/initialized') + '\n');
  proc.stdin.write(rpcRequest(2, 'tools/list') + '\n');
  proc.stdin.write(rpcRequest(3, 'tools/call', {
    name: 'generate_prompt',
    arguments: { seed: SEED },
  }) + '\n');
  proc.stdin.write(rpcRequest(4, 'tools/call', {
    name: 'list_questions',
    arguments: { seed: SEED },
  }) + '\n');

  try {
    const init = await waitFor(responses, 1);
    assert(
      init.result?.serverInfo?.name === 'linggandawang',
      `initialize 返回 serverInfo=${init.result?.serverInfo?.name} / 协议版本=${init.result?.protocolVersion}`,
    );

    const tools = await waitFor(responses, 2);
    const toolNames = (tools.result?.tools ?? []).map((t) => t.name).sort();
    assert(
      JSON.stringify(toolNames) === JSON.stringify(['generate_prompt', 'list_questions']),
      `tools/list 返回工具：${toolNames.join(', ')}`,
    );

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
