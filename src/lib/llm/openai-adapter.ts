// OpenAI 兼容格式适配器
// DeepSeek、通义千问等均兼容 OpenAI API 格式，共用此实现

import type { LLMAdapter, LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk } from './types';

/** 校验 baseUrl 安全性：仅允许 HTTPS（本地开发除外），拒绝内网地址 */
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

  // 拒绝内网保留地址（防止 SSRF）
  const host = url.hostname;
  const blockedPatterns = [
    /^169\.254\./,        // 链路本地地址（云元数据端点）
    /^10\./,              // A类私有
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // B类私有
    /^192\.168\./,        // C类私有
    /^0\./,               // 本网络
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 运营商级NAT
    /^::1$/,              // IPv6 回环
    /^fe80:/,             // IPv6 链路本地
    /^fc00:/,             // IPv6 唯一本地
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(host)) {
      throw new Error('不允许使用内网地址，存在安全风险');
    }
  }
}

export class OpenAICompatibleAdapter implements LLMAdapter {
  provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async chat(request: LLMRequest, apiKey: string, baseUrl: string): Promise<LLMResponse> {
    validateBaseUrl(baseUrl);
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: request.model || 'gpt-4o-mini',
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
      stream: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

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
        throw new Error(`LLM 请求失败 (${resp.status}): ${errText.slice(0, 200)}`);
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
        throw new Error('LLM 请求超时（30秒），请检查网络或更换服务商');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(
    request: LLMRequest,
    apiKey: string,
    baseUrl: string,
    onChunk: (chunk: LLMStreamChunk) => void,
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
      throw new Error(`LLM 流式请求失败 (${resp.status}): ${errText.slice(0, 200)}`);
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
        throw new Error('LLM 流式请求超时（120秒）');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
      reader.cancel().catch(() => {});
    }

    return { content: fullContent, model };
  }

  async testConnection(apiKey: string, baseUrl: string): Promise<boolean> {
    validateBaseUrl(baseUrl);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        return resp.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }
}
