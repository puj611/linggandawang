// OpenAI 兼容格式适配器
// DeepSeek、通义千问等均兼容 OpenAI API 格式，共用此实现
// r5增强：chat 方法集成 withRetry 指数退避重试

import type { LLMAdapter, LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk } from './types';
import { withRetry } from './withRetry';

/** 校验 baseUrl 安全性：仅允许 HTTPS（本地开发除外），拒绝内网地址
 *  防护范围：
 *  - 协议白名单（https，localhost 例外 http）
 *  - IPv4 私有/保留地址正则
 *  - IPv4-mapped IPv6（::ffff:x.x.x.x）剥离后校验
 *  - 十进制/十六进制/八进制 IPv4 归一化（如 2130706433 → 127.0.0.1）
 *  - IPv6 回环/链路本地/唯一本地
 *  - 不做 DNS 解析（轻量方案），DNS 重绑定需 Rust 代理方案彻底解决
 */
function validateBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('API 地址格式无效');
  }

  // 仅允许 HTTPS（本地开发 localhost 除外）
  if (url.protocol === 'http:') {
    const host = url.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      throw new Error('仅支持 HTTPS 地址（本地开发除外），HTTP 会导致密钥明文传输');
    }
  } else if (url.protocol !== 'https:') {
    throw new Error(`不支持的协议: ${url.protocol}，仅支持 https:`);
  }

  const host = url.hostname.toLowerCase();

  // IPv4 私有/保留地址正则
  const blockedIpv4Patterns = [
    /^169\.254\./,        // 链路本地地址（云元数据端点）
    /^10\./,              // A类私有
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // B类私有
    /^192\.168\./,        // C类私有
    /^0\./,               // 本网络
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 运营商级NAT
    /^127\./,             // 回环地址（除已显式放行的 127.0.0.1）
    /^192\.0\.0\./,       // IETF 协议分配
    /^198\.1[89]\./,      // 测试网络
    /^203\.0\.113\./,     // 文档示例
  ];

  /** 检查 IPv4 字符串是否命中黑名单 */
  function checkIpv4(ip: string): boolean {
    return blockedIpv4Patterns.some((p) => p.test(ip));
  }

  /** 将十进制/十六进制/八进制 IPv4 归一化为点分十进制，无法识别返回 null
   *  例: 2130706433 → "127.0.0.1"，0x7f000001 → "127.0.0.1"，0177.0.0.1 → "127.0.0.1"
   */
  function normalizeIpv4(raw: string): string | null {
    // 纯十进制整数（如 2130706433）
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
      return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
    }
    // 0x 开头十六进制（如 0x7f000001）
    if (/^0x[0-9a-f]+$/i.test(raw)) {
      const n = parseInt(raw, 16);
      if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
      return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
    }
    // 含 0 开头八进制分量的点分格式（如 0177.0.0.1）
    if (/^0\d*\./.test(raw)) {
      const parts = raw.split('.');
      if (parts.length !== 4) return null;
      const nums = parts.map((p) => {
        if (/^0\d*$/.test(p)) return parseInt(p, 8);
        if (/^\d+$/.test(p)) return parseInt(p, 10);
        if (/^0x[0-9a-f]+$/i.test(p)) return parseInt(p, 16);
        return NaN;
      });
      if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
      return nums.join('.');
    }
    // 标准点分十进制
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;
    return null;
  }

  // 1. 处理 IPv4-mapped IPv6：[::ffff:127.0.0.1] → 127.0.0.1
  const v4mappedMatch = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mappedMatch) {
    const ipv4 = v4mappedMatch[1];
    if (checkIpv4(ipv4)) {
      throw new Error('不允许使用内网地址（IPv4-mapped IPv6），存在安全风险');
    }
  }

  // 2. 处理纯 IPv6（不含点号）
  if (host.includes(':') && !host.includes('.')) {
    const blockedIpv6Patterns = [
      /^::1$/,              // IPv6 回环
      /^fe80:/,             // IPv6 链路本地
      /^fc00:/,             // IPv6 唯一本地
      /^fd/i,               // IPv6 唯一本地（fd00::/8）
      /^::ffff:/,           // 已在前面处理，但兜底拒绝所有 IPv4-mapped
    ];
    for (const p of blockedIpv6Patterns) {
      if (p.test(host)) {
        throw new Error('不允许使用内网地址（IPv6），存在安全风险');
      }
    }
  }

  // 3. 处理 IPv4 主机名（含点号、不含冒号）
  if (host.includes('.') && !host.includes(':')) {
    // r5修复：HTTP 127.0.0.1 已在协议检查时放行（开发环境），跳过 IPv4 内网检查
    const isHttpLoopback = url.protocol === 'http:' && host === '127.0.0.1';
    if (!isHttpLoopback) {
      // 尝试归一化（处理十进制/十六进制/八进制）
      const normalized = normalizeIpv4(host);
      if (normalized && checkIpv4(normalized)) {
        throw new Error('不允许使用内网地址，存在安全风险');
      }
      // 标准点分十进制且命中
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && checkIpv4(host)) {
        throw new Error('不允许使用内网地址，存在安全风险');
      }
    }
  }
}

/** 脱敏错误文本中的 API Key / Bearer Token，避免泄露到 UI/日志
 *  r5修复：原正则 {6,} 贪婪匹配把整个 key 都进第一组，*** 加在末尾无效脱敏
 *  改为第一组固定匹配 sk- + 4 字符，第二组匹配剩余 1+ 字符并替换为 ***
 */
function sanitizeErrorText(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9_]{4})[A-Za-z0-9\-_]+/gi, '$1***')
    .replace(/(Bearer\s+sk-[A-Za-z0-9_]{4})[A-Za-z0-9\-_]+/gi, '$1***');
}

export class OpenAICompatibleAdapter implements LLMAdapter {
  provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async chat(
    request: LLMRequest,
    apiKey: string,
    baseUrl: string,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    validateBaseUrl(baseUrl);
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: request.model || 'gpt-4o-mini',
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
      stream: false,
    };

    // r5增强：用 withRetry 包裹核心请求逻辑，对可重试错误自动指数退避
    return withRetry(async () => {
      // 内部 controller 用于自己的 30s 兜底超时（每次重试都新建）
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      // 外部 signal 联动：触发时也 abort 内部 controller
      const onExternalAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          // P2-3 安全：脱敏可能回显的 API Key / Bearer Token
          throw new Error(`LLM 请求失败 (${resp.status}): ${sanitizeErrorText(errText.slice(0, 200))}`);
        }

        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content ?? '';
        return {
          content,
          model: data.model ?? body.model,
          usage: data.usage,
        };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          // 区分是外部 signal 还是内部 timeout 触发的
          if (signal?.aborted) {
            throw new Error('LLM 请求被外部取消（调用方超时或主动取消）');
          }
          throw new Error('LLM 请求超时（30秒），请检查网络或更换服务商');
        }
        throw e;
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onExternalAbort);
      }
    });
  }

  async chatStream(
    request: LLMRequest,
    apiKey: string,
    baseUrl: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    validateBaseUrl(baseUrl);
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: request.model || 'gpt-4o-mini',
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
      stream: true,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    // 外部 signal 联动
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      // P2-3 安全：脱敏可能回显的 API Key / Bearer Token
      throw new Error(`LLM 流式请求失败 (${resp.status}): ${sanitizeErrorText(errText.slice(0, 200))}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let model = body.model;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            onChunk({ delta: '', done: true });
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              fullContent += delta;
              onChunk({ delta, done: false });
            }
            if (parsed.model) model = parsed.model;
          } catch {
            // 跳过无法解析的行
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        if (signal?.aborted) {
          throw new Error('LLM 流式请求被外部取消');
        }
        throw new Error('LLM 流式请求超时（120秒）');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      reader.cancel().catch(() => {});
    }

    return { content: fullContent, model };
  }

  async testConnection(apiKey: string, baseUrl: string, signal?: AbortSignal): Promise<boolean> {
    validateBaseUrl(baseUrl);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // 外部 signal 联动
      const onExternalAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      try {
        const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        return resp.ok;
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onExternalAbort);
      }
    } catch {
      return false;
    }
  }
}
