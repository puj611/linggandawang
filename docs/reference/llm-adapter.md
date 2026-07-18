# LLM 适配器接口文档

> 本文档描述 `src/lib/llm/` 下的 LLM 适配器接口与实现。
> 适配器统一所有 LLM 服务商为 OpenAI 兼容格式。

## 目录结构

```
src/lib/llm/
├── types.ts             # 接口与类型定义 + 4 个预设服务商配置
├── openai-adapter.ts    # OpenAI 兼容适配器实现（DeepSeek/通义/自定义共用）
└── index.ts             # 适配器工厂 + 统一导出
```

## 一、核心接口

### LLMAdapter

```typescript
interface LLMAdapter {
  provider: LLMProvider;

  /** 发送请求并获取完整响应 */
  chat(request: LLMRequest, apiKey: string, baseUrl: string): Promise<LLMResponse>;

  /** 发送流式请求，通过 onChunk 回调推送增量 */
  chatStream(
    request: LLMRequest,
    apiKey: string,
    baseUrl: string,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMResponse>;

  /** 测试连接是否可用 */
  testConnection(apiKey: string, baseUrl: string): Promise<boolean>;
}
```

### LLMRequest

```typescript
interface LLMRequest {
  messages: ChatMessage[];
  model?: string;        // 缺省时使用 'gpt-4o-mini'
  temperature?: number;   // 缺省 0.7
  max_tokens?: number;
  stream?: boolean;
}
```

### LLMResponse

```typescript
interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
```

### ChatMessage

```typescript
type ChatRole = 'system' | 'user' | 'assistant';
interface ChatMessage {
  role: ChatRole;
  content: string;
}
```

## 二、服务商配置

### LLMProvider

```typescript
type LLMProvider = 'openai' | 'deepseek' | 'tongyi' | 'xiaomi' | 'custom';
```

### PROVIDER_PRESETS（5 个预设）

| provider | label | baseUrl | defaultModel | models | 说明 |
|---|---|---|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | `deepseek-chat`, `deepseek-reasoner` | 性价比高，中文理解能力强 |
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo` | 综合能力最强，成本较高 |
| `tongyi` | 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `qwen-plus`, `qwen-turbo`, `qwen-max` | 阿里云出品，国内访问快 |
| `xiaomi` | 小米 MiMo | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro` | `mimo-v2.5-pro`, `mimo-v2-pro`, `mimo-v2-flash` | 小米 MiMo 模型，OpenAI 兼容 |
| `custom` | 自定义 | `''`（用户填写） | `''` | `[]` | 兼容 OpenAI 格式的任意 API |

## 三、适配器工厂

```typescript
// src/lib/llm/index.ts
import { getAdapter } from '@/lib/llm';

const adapter = getAdapter('deepseek');
const response = await adapter.chat(
  { messages: [{ role: 'user', content: 'Hello' }] },
  apiKey,
  'https://api.deepseek.com/v1',
);
```

- **缓存**：适配器实例按 provider 缓存（`Map<string, LLMAdapter>`），重复调用返回同一实例
- **统一实现**：DeepSeek、通义、自定义均使用 `OpenAICompatibleAdapter`（它们都兼容 OpenAI API 格式）

## 四、OpenAICompatibleAdapter 实现

### 4.1 chat（完整响应）

**请求**：POST `{baseUrl}/chat/completions`，`stream: false`

**超时**：30 秒（`AbortController` + `setTimeout`）

**响应解析**：`data.choices[0].message.content`

**错误处理**：
- HTTP 非 2xx：抛出 `LLM 请求失败 ({status}): {body前200字符}`
- 超时：抛出 `LLM 请求超时（30秒），请检查网络或更换服务商`
- 网络错误：原样抛出

### 4.2 chatStream（流式响应）

**请求**：POST `{baseUrl}/chat/completions`，`stream: true`

**超时**：120 秒（流式响应需要更长时间）

**SSE 解析**：
- 按 `\n` 分割行，仅处理 `data: ` 前缀的行
- `[DONE]` 标记流结束
- 每行 JSON 解析后提取 `choices[0].delta.content`

**回调**：`onChunk({ delta: string, done: boolean })`

### 4.3 testConnection

**请求**：GET `{baseUrl}/models`，带 `Authorization: Bearer {apiKey}` header

**超时**：10 秒

**返回**：`resp.ok`（HTTP 2xx 返回 true，其他返回 false，异常返回 false）

## 五、安全机制

### baseUrl 校验（validateBaseUrl）

每个请求前都会校验 `baseUrl`：

1. **URL 格式**：必须能被 `new URL()` 解析
2. **协议**：
   - `https:` — 允许
   - `http:` — 仅允许 `localhost` 和 `127.0.0.1`（本地开发）
   - 其他协议 — 拒绝
3. **SSRF 防护**：拒绝以下内网地址
   - `169.254.*`（链路本地，云元数据端点）
   - `10.*`（A 类私有）
   - `172.16-31.*`（B 类私有）
   - `192.168.*`（C 类私有）
   - `0.*`（本网络）
   - `100.64-127.*`（运营商级 NAT）
   - `::1`（IPv6 回环）
   - `fe80:`（IPv6 链路本地）
   - `fc00:`（IPv6 唯一本地）

### API Key 传输

- API Key 通过 `Authorization: Bearer {apiKey}` header 传输
- 不出现在 URL query 参数中
- 不记录到日志（当前版本无日志记录逻辑）
- 存储通过 keyring crate → Windows Credential Manager（参见 [tauri-commands.md](tauri-commands.md) §3）

## 六、前端调用链

```
src/stores/apiKeyStore.ts
  ├── load()           → 读取 SQLite 中的 provider/baseUrl/model 配置
  ├── saveConfig()     → 保存非敏感配置到 SQLite
  ├── saveApiKey()     → invoke('save_api_key') → Credential Manager
  ├── getApiKey()      → invoke('load_api_key') → Credential Manager
  ├── testConnection() → getAdapter(provider).testConnection(apiKey, baseUrl)
  └── (生成提示词时)   → getAdapter(provider).chat/chatStream(...)
```

## 七、待实现（M9.4 稳定性层规划）

以下功能在当前代码中**尚未实现**，属于 M9.4 规划范围：

| 功能 | 说明 | 状态 |
|---|---|---|
| 会话级熔断器 | 连续 N 次失败后暂停 LLM 调用，降级为纯规则引擎 | 🔲 待实现 |
| 错误分类 | 7 类错误（网络/认证/限流/服务端/超时/格式/未知）分别处理 | 🔲 待实现 |
| 指数退避重试 | 5xx 错误自动重试，指数退避（1s/2s/4s） | 🔲 待实现 |
| API Key 脱敏日志 | 日志中 API Key 以 `sk-***xxxx` 格式显示 | 🔲 待实现 |
