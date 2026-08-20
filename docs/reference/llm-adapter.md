# LLM 适配器接口文档

> 本文档描述 `src/lib/llm/` 下的 LLM 适配器接口与实现。
> 适配器统一所有 LLM 服务商为 OpenAI 兼容格式。

## 目录结构

```
src/lib/llm/
├── types.ts             # 接口与类型定义 + 5 个预设服务商配置 + isVisionModel()
├── openai-adapter.ts    # OpenAI 兼容适配器实现（全部 provider 共用，Tauri 环境自动走 Rust 代理）
├── withRetry.ts         # 指数退避重试（1s/3s，最大重试 2 次）
├── error-messages.ts    # LLM 错误分类（7 类）+ 中文友好提示 + 熔断参数
└── index.ts             # 适配器工厂 + 统一导出
```

## 一、核心接口

### LLMAdapter

```typescript
interface LLMAdapter {
  provider: LLMProvider;

  /** 发送请求并获取完整响应
   *  signal：可选外部取消信号，触发时 fetch 被中止并抛 AbortError；
   *  调用方可用更短的业务超时覆盖 adapter 内部默认超时 */
  chat(request: LLMRequest, apiKey: string, baseUrl: string, signal?: AbortSignal): Promise<LLMResponse>;

  /** 发送流式请求，通过 onChunk 回调推送增量（signal 同上） */
  chatStream(
    request: LLMRequest,
    apiKey: string,
    baseUrl: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<LLMResponse>;

  /** 测试连接是否可用（signal 同上） */
  testConnection(apiKey: string, baseUrl: string, signal?: AbortSignal): Promise<boolean>;
}
```

### LLMRequest

```typescript
interface LLMRequest {
  messages: ChatMessage[];
  model?: string;        // 缺省时：非 local 用 'gpt-4o-mini'，local 用 'local'
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

### ChatMessage（支持多模态）

```typescript
type ChatRole = 'system' | 'user' | 'assistant';
interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];  // 纯文本或多模态内容数组
}
// ContentPart = { type: 'text'; text: string }
//            | { type: 'image_url'; image_url: { url: string; detail?: 'low'|'high'|'auto' } }
```

- 图片 URL 支持 `data:image/...;base64,...` 或 `https://...`
- 配套 `isVisionModel(model)` 工具函数（types.ts）按模型名关键词判断是否支持视觉输入

## 二、服务商配置

### LLMProvider

```typescript
type LLMProvider = 'openai' | 'deepseek' | 'tongyi' | 'custom' | 'local';
```

### PROVIDER_PRESETS（5 个预设）

| provider | label | baseUrl | defaultModel | models | 说明 |
|---|---|---|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | `deepseek-chat`, `deepseek-reasoner` | 性价比高，中文理解能力强 |
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo` | 综合能力最强，成本较高 |
| `tongyi` | 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `qwen-plus`, `qwen-turbo`, `qwen-max` | 阿里云出品，国内访问快 |
| `custom` | 自定义 | `''`（用户填写） | `''` | `[]` | 兼容 OpenAI 格式的任意 API |
| `local` | 本地模型 | `http://127.0.0.1:11434/v1` | `local` | `local` | llama.cpp 本地推理，零成本、离线可用、隐私安全 |

> `local` 由 llama-server sidecar 提供推理（进程管理见 [tauri-commands.md](tauri-commands.md) §十）；无需 API Key（不发 Authorization header）；超时比云端更长（CPU 推理较慢）。

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
- **统一实现**：全部 5 个 provider 均使用 `OpenAICompatibleAdapter`（它们都兼容 OpenAI API 格式，含 local 的 llama-server）

## 四、OpenAICompatibleAdapter 实现

### 4.1 chat（完整响应，双模式）

**Tauri 模式（默认）**：`chat()` 检测 `isTauri()` 为真时自动走 `chatViaProxy()`：

- 调用 `invoke('llm_proxy_chat', { req: {...} })`（见 [tauri-commands.md](tauri-commands.md) §8.1）
- **密钥代理注入**：API Key 由 Rust 从 keyring 读取注入，前端不接触明文 key（`apiKey` 参数被忽略）
- **SSRF 终审**：Rust 侧做 DNS 解析校验（防 DNS 重绑定），前端 `validateBaseUrl` 仅作为快速失败的前置校验
- **超时透传**：`timeoutMs` 转为 `timeout_secs`（`max(5, round(timeoutMs/1000))`）传给 Rust，由 `tokio::time::timeout` 真正中断 reqwest
- **取消机制（signal 竞速）**：Tauri invoke 不支持 AbortSignal 取消，故用 `Promise.race([doInvoke, abortPromise])` 包装——调用方超时/取消时 Promise 立即 reject（调用方降级不阻塞），同时 Rust 侧按 `timeout_secs` 回收请求副作用
- 不支持流式（Rust 固定 `stream: false`）；流式需求走浏览器模式 `chatStream`

**浏览器模式（直连）**：

- **请求**：POST `{baseUrl}/chat/completions`，`stream: false`
- **超时**：local 120 秒（CPU 推理较慢）/ 其他 provider 30 秒（`AbortController` + `setTimeout`）
- **重试**：整个请求包在 `withRetry()` 中——可重试错误（rate_limit/server/network/timeout）指数退避重试（1s/3s，最多 2 次）；外部 `signal` 已 aborted 时立即抛出不再重试
- **响应解析**：`data.choices[0].message.content`
- **错误处理**：
  - HTTP 非 2xx：抛出 `LLM 请求失败 ({status}): {body前200字符}`（body 经 `sanitizeErrorText` 脱敏）
  - 超时：抛出 `LLM 请求超时（30秒）...` / local 为 `本地模型推理超时（120秒）...`
  - 外部取消：抛出 `LLM 请求被调用方取消`（消息不含「超时」字样，避免被错误分类为可重试导致无意义重试）
  - 网络错误：原样抛出（由调用方经 `classifyLLMError` 分类）

### 4.2 chatStream（流式响应，仅浏览器直连）

**请求**：POST `{baseUrl}/chat/completions`，`stream: true`

**超时**：local 180 秒 / 其他 provider 120 秒（流式响应需要更长时间）

**重试**：仅对建立连接阶段（fetch + resp.ok）重试（`withRetry` 包裹连接部分）；一旦开始读取流（`reader.read()`）不再重试，避免 chunks 重复发送

**SSE 解析**：
- 按 `\n` 分割行，仅处理 `data: ` 前缀的行
- `[DONE]` 标记流结束
- 每行 JSON 解析后提取 `choices[0].delta.content`

**回调**：`onChunk({ delta: string, done: boolean })`

### 4.3 testConnection

**Tauri 模式**：调用 `invoke('llm_proxy_test', { provider, baseUrl })`（Rust 读 key 注入 + SSRF 校验 + GET /models，10 秒超时；见 [tauri-commands.md](tauri-commands.md) §8.2）

**浏览器模式（直连）**：

- **请求**：GET `{baseUrl}/models`，带 `Authorization: Bearer {apiKey}` header（local 不带）
- **超时**：local 5 秒 / 其他 provider 10 秒
- **返回**：`resp.ok`（HTTP 2xx 返回 true，其他返回 false，异常返回 false）

## 五、安全机制

### baseUrl 校验（validateBaseUrl，openai-adapter.ts）

每个请求前都会校验 `baseUrl`（Tauri 模式下作为快速失败的前置校验，Rust 侧为最终校验）：

1. **URL 格式**：必须能被 `new URL()` 解析
2. **协议**：
   - `https:` — 允许
   - `http:` — 仅允许 `localhost` 和 `127.0.0.1`（本地开发，如 local provider 的 `http://127.0.0.1:11434/v1`）
   - 其他协议 — 拒绝
3. **SSRF 防护**：拒绝以下内网/保留地址
   - `169.254.*`（链路本地，云元数据端点）
   - `10.*`（A 类私有）
   - `172.16-31.*`（B 类私有）
   - `192.168.*`（C 类私有）
   - `0.*`（本网络）
   - `100.64-127.*`（运营商级 NAT）
   - `127.*`（回环，除协议检查时已显式放行的 `http://127.0.0.1`）
   - `192.0.0.*`（IETF 协议分配）、`198.18-19.*`（测试网络）、`203.0.113.*`（文档示例）
   - `::1`（IPv6 回环）
   - `fe80:`（IPv6 链路本地）
   - `fc00:` / `fd*`（IPv6 唯一本地）
4. **归一化对抗**（防绕过）：
   - IPv4-mapped IPv6：`[::ffff:127.0.0.1]` 剥离映射后按 IPv4 校验
   - 十进制/十六进制/八进制 IPv4 归一化：`2130706433` / `0x7f000001` / `0177.0.0.1` 均归一化为点分十进制后再校验
5. **不做 DNS 解析**（轻量方案）：DNS 重绑定攻击由 Rust 代理（`llm_proxy_chat` 的 `validate_ssrf`）彻底解决

### API Key 传输与脱敏

- Tauri 模式：key 由 Rust 从 keyring 读取注入（前端不接触明文，见 [tauri-commands.md](tauri-commands.md) §8）
- 浏览器模式：通过 `Authorization: Bearer {apiKey}` header 传输，不出现在 URL query 参数中
- **脱敏日志已实现**：
  - 前端 `sanitizeErrorText()`：错误文本中的 key 显示为 `sk-xxxx***`（前 4 字符 + `***`）
  - Rust 侧 `sanitize()`：去除回显文本中的 `Bearer ` 前缀
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

src/engine/*（LLMIntentAnalyzer / SmartFollowup / ImagePromptExtractor / RequirementSyncer）
  ├── 调用前           → useLLMAvailabilityStore.getState().shouldAttempt()（熔断中直接降级为纯规则）
  └── 调用后           → 成功 recordSuccess() / 失败 recordFailure(e)（驱动熔断状态机）
```

## 七、稳定性层（M9.4，已实现）

以下功能均已落地，不再是规划状态：

| 功能 | 实现 | 状态 |
|---|---|---|
| 错误分类 | `error-messages.ts` 的 `classifyLLMError()`：7 类错误（auth/rate_limit/server/network/timeout/bad_request/unknown），返回 `{ kind, retryable, friendlyMessage, suggestion }` | ✅ 已实现 |
| 指数退避重试 | `withRetry.ts`：可重试错误（rate_limit/server/network/timeout）退避重试，间隔第 1 次 1s、第 2 次 3s，最大重试 2 次（共 3 次尝试）；不可重试错误立即抛出；外部 `signal` 已 aborted 时直接抛出不再重试 | ✅ 已实现 |
| 会话级熔断器 | `src/stores/llmAvailabilityStore.ts`：按错误类型分别计数，达阈值熔断（degraded 状态跳过 LLM 调用降级纯规则引擎） | ✅ 已实现 |
| API Key 脱敏 | 前端 `sanitizeErrorText()`（`sk-xxxx***`）+ Rust 侧 `sanitize()`（去除 Bearer 前缀），见第五章 | ✅ 已实现 |

### 熔断参数（error-messages.ts）

| 错误类型 | 熔断阈值（连续失败次数） | 熔断时长 |
|---|---|---|
| auth | 1 次（Key 问题不会自愈，立即熔断） | 30 分钟 |
| rate_limit / server | 3 次 | 5 分钟 |
| network / timeout | 2~3 次（network 3 次，timeout 2 次） | 2 分钟 |
| bad_request / unknown | 不熔断（Infinity） | — |

- **半开探测**：熔断到期后 `shouldAttempt()` 返回 true 放行一次探测，成功后 `recordSuccess()` 切回 available
- **手动重置**：`reset()` 供用户点击「立即重试」时调用
- **UI 提示**：`getStatusMessage()` 返回降级提示文本（含剩余分钟数与排查建议）
