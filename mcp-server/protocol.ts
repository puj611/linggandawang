// mcp-server/protocol.ts
// MCP 协议层：手写 JSON-RPC 2.0（MCP stdio 传输 = 每行一条 JSON 消息）。
// 最小实现四个方法：initialize / tools/list / tools/call / ping，
// 通知（notifications/*）静默丢弃。不依赖 @modelcontextprotocol/sdk 与 zod，
// 因为本机无 npm/pnpm/yarn 可用（Adobe node.exe 单文件，无包管理器），
// 且 SDK 的 express 全家桶对 stdio server 属于过度依赖。
import {
  TOOL_DEFINITIONS,
  UnknownToolError,
  callToolByName,
  type McpToolResult,
} from './tools';

/** JSON-RPC 2.0 消息类型 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const SERVER_INFO = { name: 'linggandawang', version: '0.1.0' };

/** 服务器默认协议版本（客户端传入其他版本时回显客户端值，保持兼容） */
export const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

const JSON_RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

function okResponse(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(
  id: number | string | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * 处理单条 JSON-RPC 消息。
 * @returns 需要写回 stdout 的响应；通知（无 id 或 notifications/*）返回 null
 */
export async function handleJsonRpc(msg: unknown): Promise<JsonRpcResponse | null> {
  if (
    typeof msg !== 'object' ||
    msg === null ||
    !('method' in msg) ||
    typeof (msg as { method?: unknown }).method !== 'string'
  ) {
    const id = (msg as { id?: number | string | null })?.id ?? null;
    return errorResponse(id, JSON_RPC_ERROR.INVALID_REQUEST, 'Invalid Request');
  }
  const req = msg as JsonRpcRequest;
  const isNotification = req.id === undefined || req.id === null;

  try {
    switch (req.method) {
      case 'initialize': {
        const params = (req.params ?? {}) as { protocolVersion?: string };
        return okResponse(req.id!, {
          protocolVersion: params.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });
      }

      case 'ping':
        return okResponse(req.id!, {});

      case 'tools/list':
        return okResponse(req.id!, { tools: TOOL_DEFINITIONS });

      case 'tools/call': {
        const params = (req.params ?? {}) as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const toolResult: McpToolResult = callToolByName(
          params.name ?? '',
          params.arguments ?? {},
        );
        return okResponse(req.id!, toolResult);
      }

      default: {
        // 通知（含 notifications/initialized）不需要响应
        if (req.method.startsWith('notifications/') || isNotification) return null;
        return errorResponse(
          req.id!,
          JSON_RPC_ERROR.METHOD_NOT_FOUND,
          `Method not found: ${req.method}`,
        );
      }
    }
  } catch (e) {
    if (e instanceof UnknownToolError) {
      return errorResponse(req.id!, JSON_RPC_ERROR.INVALID_PARAMS, e.message);
    }
    if (isNotification) return null;
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(
      req.id!,
      JSON_RPC_ERROR.INTERNAL_ERROR,
      `Internal error: ${message}`,
    );
  }
}
