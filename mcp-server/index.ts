// mcp-server/index.ts
// 灵感大王 MCP stdio server 入口。
// 运行方式（vite 预构建产物）：
//   node mcp-server/dist/index.js
// 协议：MCP over stdio（newline-delimited JSON-RPC 2.0），见 protocol.ts。
// 引擎复用：src/engine 的 QuestionEngine / seedRouter / PromptGenerator 纯逻辑部分，
// 免 API key、无网络调用（本文件经 mcp-server/vite.config.ts 预构建后运行，
// 以处理引擎侧 Vite 专属的 *.yaml?raw 导入）。
import { createInterface } from 'node:readline';
import { handleJsonRpc, type JsonRpcResponse } from './protocol';

/** stdout 只允许写协议消息（newline-delimited JSON），任何日志走 stderr */
function respond(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function redirectConsoleToStderr(): void {
  // MCP stdio 规范：stdout 是协议通道，引擎内部的 console.log/warn 必须重定向，
  // 否则一行日志就会让 Claude Code/Cursor 的 JSON 解析失败。
  // console.error 本身走 stderr，无需处理。
  const warn = console.warn.bind(console);
  console.log = (...args: unknown[]) => warn('[mcp]', ...args);
  process.on('uncaughtException', (err) => {
    warn('[mcp] uncaughtException:', err);
  });
  process.on('unhandledRejection', (reason) => {
    warn('[mcp] unhandledRejection:', reason);
  });
}

async function processLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    respond({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    return;
  }
  const res = await handleJsonRpc(msg);
  if (res) respond(res);
}

function main(): void {
  redirectConsoleToStderr();
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    void processLine(line);
  });
  rl.on('close', () => {
    // 客户端关闭 stdin（如 Claude Code 退出），进程随之退出
    process.exit(0);
  });
}

main();
