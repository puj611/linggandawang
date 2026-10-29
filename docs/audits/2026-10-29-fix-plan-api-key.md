# 修复方案：密钥不出前端 + engine 解耦

> 针对 `docs/audits/2026-10-29-v0.9.2-preflight.md` 高危 ①②。涉及 ≥3 文件 + 改公共接口，按项目规矩先出方案待确认。

## 前提事实（已核实）

| 事实 | 证据 |
|---|---|
| `chatStream` **无任何生产调用** | 全库搜 `.chatStream(` 仅命中 adapter 自身定义 |
| 4 处 engine 全用 `adapter.chat(...)` | `ImagePromptExtractor:143`、`LLMIntentAnalyzer:116`、`RequirementSyncer:63`、`SmartFollowup:213` |
| Tauri 模式下 `chat()` 已走 Rust 代理 | `openai-adapter.ts:162` `if (isTauri()) return this.chatViaProxy(...)` |
| 代理内 key 由 Rust 从 keyring 注入 | `llm_proxy.rs:156,181-183` |
| 两处 `ALLOWED_PROVIDERS` 不一致 | `api_key.rs:5` 无 `local`；`llm_proxy.rs:14` 有 `local` |

**推论**：Tauri 生产路径上，`chat()` 根本不读 `apiKey` 参数（proxy 分支直接 return）。所以 4 处 engine 调 `getApiKey()` 取明文是**纯粹的无用泄露**——不取也能正常工作。

## 方案（三层，按风险从低到高）

### Layer 1（必做，零行为变更）

**1.1 删除 4 处 engine 的 `getApiKey()` 调用**

```ts
// 现状（engine/LLMIntentAnalyzer.ts:100）
const apiKey = await useApiKeyStore.getState().getApiKey();
if (!apiKey) return null;
...
const response = await adapter.chat(messages, apiKey, config.baseUrl, signal);

// 改为
// 「是否已配置」由调用方（hook）判定；engine 不再碰 store
const response = await adapter.chat(messages, '', config.baseUrl, signal);
```

- **Tauri 模式**：`chat` 走 proxy，`apiKey` 参数被忽略 → 行为完全不变。
- **浏览器模式**：`chat` 直连需要真 key → 该路径会失效。**这是本方案唯一的功能影响**。
  - 处置：浏览器模式本就不是主场景（产品定位是桌面应用），且 README 已注明「浏览器模式供开发调试」。若必须保留，改由 hook 传入 key（见 Layer 3）。

**1.2 `load_api_key` 改为存在性查询**

```rust
// api_key.rs 新增，保留旧命令但标记 deprecated
#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    validate_provider(&provider)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|_| "密钥存储服务不可用".to_string())?;
    Ok(entry.get_password().is_ok())
}
```

前端 `apiKeyStore.load()` 改用 `has_api_key`（它现在也只用来判断 `hasApiKey = !!key`）。
`getApiKey()` 保留但加 `@deprecated` 注释 + eslint 限制调用点，仅 `apiKeyStore` 内部测试用。

**1.3 统一 `ALLOWED_PROVIDERS`**

`api_key.rs` 改为引用 `llm_proxy::ALLOWED_PROVIDERS`（含 `local`，因为 local 虽无 key 但 `save/load/delete` 需一致处理空 key）。

**1.4 `chatStream` 标注**

既然无生产调用，先加注释标明「⚠️ 未接入 Rust 代理，仅浏览器模式可用；接生产前必须改走代理」，避免未来误用。

### Layer 2（本迭代，中风险）

**2.1 engine 彻底不依赖 stores**

把 `useApiKeyStore.getState()` 从 4 个 engine 文件移除（Layer 1 已做），并补一条架构测试：断言 `src/engine/**` 不含 `@/stores`、`@tauri-apps` 的 import。

```ts
// src/engine/__tests__/layering.test.ts（新增）
const ENGINE_FILES = glob('src/engine/**/*.ts').filter(非 __tests__);
for (const f of ENGINE_FILES) {
  expect(read(f)).not.toMatch(/from '@\/stores/);
  expect(read(f)).not.toMatch(/from '@tauri-apps/);
}
```
注意：`QuestionLoader.ts` 有 `isTauri()` 门控的动态 import（AGENTS 坑点已备案为唯一例外），断言需放行该模式。

### Layer 3（Backlog，可延后）

**3.1 `chatStream` 接入 Rust 代理**（若未来真要用流式）：`llm_proxy_chat` 加 `stream: bool`，用 Tauri event 推 chunk。
**3.2 浏览器模式的 key 注入**：若要在浏览器保留完整功能，由 hook 注入 key 给 adapter，engine 仍不碰 store。

## 影响面

| 文件 | 改动 | 风险 |
|---|---|---|
| `src/engine/{4 个}.ts` | 删 `getApiKey` 调用 + import | 低（Tauri 路径行为不变） |
| `src/stores/apiKeyStore.ts` | `load` 用 `has_api_key`；`getApiKey` 标 deprecated | 低 |
| `src-tauri/src/commands/api_key.rs` | 新增 `has_api_key` + 统一常量 | 低（纯新增） |
| `src/lib/llm/openai-adapter.ts` | `chatStream` 加警示注释 | 零 |
| `src/engine/__tests__/layering.test.ts` | 新增分层断言 | 零 |

**不做**（本轮）：`image.rs` 白名单、`debugReporter` 清理、`sanitize` 重构、Client 池化——都是中低危，单独排。

## 验证标准

1. `cargo test` 全过（含新增 has_api_key 单测）
2. `tsc` / `lint` / `vitest` 全绿，测试数不减少
3. 新增 layering 测试通过
4. `npm run build` + `cargo check` 通过
5. 人工：Tauri dev 模式下一次真实 LLM 调用成功（证明删 key 后 chat 仍工作）

## 需要你决定

**浏览器模式是否要保留完整功能？**
- A：不保留（推荐）—— 浏览器仅作 UI 调试，LLM 调用在浏览器下直接报「请用桌面版」。改动最小，安全最优。
- B：保留 —— 需在 hooks 层把 key 传给 adapter，engine 仍不碰 store。多改 3-4 个 hook。
