# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260624-001] best_practice

**Logged**: 2026-06-24T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
API Key 必须通过 keyring（Windows Credential Manager）存储，不能明文存入 SQLite 或 JSON 文件

### Details
M8.5 实现了 keyring crate v3 的安全存储方案，密钥与配置分离（密钥存 keyring，配置存 SQLite user_preferences）

### Suggested Action
后续所有敏感数据（token、密码、密钥）都应使用 keyring，不要用明文文件

### Metadata
- Source: conversation
- Tags: security, api-key, keyring, m8.5

---

## [LRN-20260624-002] correction

**Logged**: 2026-06-24T00:00:00+08:00
**Priority**: critical
**Status**: pending
**Area**: config

### Summary
Tauri CSP 不能设为 null，必须设置严格的内容安全策略

### Details
tauri.conf.json 中 "csp": null 导致 webview 可加载任意远程脚本，存在 XSS 风险。已修复为严格 CSP 策略

### Suggested Action
所有 Tauri 项目必须在 tauri.conf.json 中设置 CSP

### Metadata
- Source: conversation
- Related Files: src-tauri/tauri.conf.json
- Tags: security, tauri, csp, xss

---

## [LRN-20260624-003] correction

**Logged**: 2026-06-24T00:00:00+08:00
**Priority**: critical
**Status**: pending
**Area**: backend

### Summary
LLM baseUrl 必须校验 HTTPS 和内网地址，防止 SSRF 和密钥泄露

### Details
openai-adapter.ts 中直接使用用户输入的 baseUrl 发起 fetch，未校验协议和地址。已添加 validateBaseUrl 函数

### Suggested Action
所有用户可自定义的 URL 都必须经过安全校验

### Metadata
- Source: conversation
- Related Files: openai-adapter.ts
- Tags: security, ssrf, llm, url-validation

---

## [LRN-20260624-004] insight

**Logged**: 2026-06-24T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: infra

### Summary
TRAE IDE 沙箱会拦截 Rust build script 的子进程调用，导致 tauri build 失败

### Details
报错 "Os { code: 0, message: 操作成功完成。" } 不是 Windows SDK 问题，是 TRAE 沙箱限制。在独立 PowerShell 中执行即可

### Suggested Action
Rust 编译/打包命令不要在 TRAE 内置终端执行

### Metadata
- Source: error
- Tags: trae, rust, build, sandbox, tauri-build

---

## [LRN-20260624-005] best_practice

**Logged**: 2026-06-24T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: config

### Summary
敏感文件黑名单需要定期更新，且不能使用含路径分隔符的模式

### Details
.ssh/ 和 .aws/credentials 模式永远不会匹配 file_name()，因为文件名不含路径分隔符。已修复为 .ssh 和 .aws

### Suggested Action
使用精确匹配或后缀匹配，而非全子串匹配

### Metadata
- Source: conversation
- Tags: security, file-matching, sensitive-files

---

## [LRN-20260624-006] knowledge_gap

**Logged**: 2026-06-24T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: backend

### Summary
lib.rs 单文件已膨胀至 700+ 行，M10 前需要拆分为模块

### Details
当前所有 Tauri 命令都在 lib.rs 中，M10 需新增 6-8 个项目扫描命令，文件将膨胀至 1000+ 行

### Suggested Action
按 context.rs/preferences.rs/api_key.rs/user_bank.rs/window.rs/project_scanner.rs/image.rs 拆分

### Metadata
- Source: conversation
- Related Files: src-tauri/src/lib.rs
- Tags: refactor, rust, lib.rs, m10, code-organization

---

## [LRN-20260704-007] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: critical
**Status**: pending
**Area**: backend

### Summary
SQLite migration 必须前后端对齐：lib.rs 中 sql_migrations 注册版本号要与 migrations/*.sql 文件数一致

### Details
P0-1 修复：prompt_history 表的 favorite 列在前端 sqlite.ts 中被引用（listPromptHistory/togglePromptFavorite），但 migrations 目录只有 0001-0003 三个迁移，桌面端运行 togglePromptFavorite 时会报 "no such column: favorite"。新增 0004_add_favorite_to_prompt_history.sql 并在 lib.rs sqlite_migrations() 中注册 version 4。

### Suggested Action
新增 SQL 字段时，三处必须同步：① migrations/*.sql 文件 ② lib.rs sqlite_migrations() 注册 ③ 前端 sqlite.ts 的 SQL 查询

### Metadata
- Source: code-review
- Related Files: src-tauri/migrations/0004_add_favorite_to_prompt_history.sql, src-tauri/src/lib.rs, src/lib/sqlite.ts
- Tags: sqlite, migration, schema-drift, p0

---

## [LRN-20260704-008] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: security

### Summary
SSRF 防护必须覆盖 IPv4 多种归一化形式（十进制/十六进制/八进制/IPv4-mapped IPv6），不能只查点分十进制

### Details
P1-1 修复：openai-adapter.ts 的 validateBaseUrl 原先只校验点分十进制私网地址，攻击者可用 2130706433（十进制整数 = 127.0.0.1）或 0x7f000001（十六进制）绕过。新增 normalizeIpv4 函数覆盖四种格式，并检测 IPv4-mapped IPv6 (::ffff:127.0.0.1) 和纯 IPv6 私网地址（fe80::、::1 等）。

### Suggested Action
所有用户可输入的 URL/host 字段都应通过归一化后再做黑名单匹配；CSP 白名单是第二道防线，必须严格枚举允许的域名。

### Metadata
- Source: code-review
- Related Files: src/lib/llm/openai-adapter.ts, src-tauri/tauri.conf.json
- Tags: security, ssrf, ip-normalization, ipv6, csp, p1

---

## [LRN-20260704-009] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: security

### Summary
浏览器模式下 API Key 不能存 localStorage（持久化 XSS 即可窃取），改用 sessionStorage + 启动警告

### Details
P1-3 修复：apiKeyStore.ts 浏览器降级分支原先用 localStorage，关闭浏览器后 Key 仍残留。改为 sessionStorage（关闭标签页即清除），并在 LLMConfigSection 中提示"浏览器模式不安全，仅用于本地 Demo"。

### Suggested Action
桌面端必须走 keyring（Windows Credential Manager）；浏览器模式仅作为 Demo 降级，且必须用 sessionStorage + 明确警告。

### Metadata
- Source: code-review
- Related Files: src/stores/apiKeyStore.ts, src/components/LLMConfigSection.tsx
- Tags: security, api-key, session-storage, browser-mode, p1

---

## [LRN-20260704-010] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
Zustand store 的读-改-写操作必须串行化，否则并发调用会丢失更新

### Details
P1-4 修复：contextStore 的 save(patch) 先 getState 读、再 setState 写，多个 await 交叉时旧状态会覆盖新状态（例如 useFlow.start 中 analyzeIntent 与 restart 的 clear 并发）。新增模块级 opsChain Promise 链，所有 mutating 操作通过 enqueue(task) 串行执行。

### Suggested Action
任何 Zustand store 中"读后写"的操作都应用 enqueue 串行化；或改用 setState((prev) => newState) 函数式更新避免读旧值。

### Metadata
- Source: code-review
- Related Files: src/stores/contextStore.ts
- Tags: zustand, race-condition, serialization, p1

---

## [LRN-20260704-011] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
异步流程切换必须用序列号（startSeq）取消旧任务，否则用户快速重新 start 会出现状态错乱

### Details
P1-5 修复：useFlow.start 中 await analyzeIntent 期间用户可能再点 start，旧任务完成后会用过时的 ctx 覆盖新流程。新增模块级 startSeq 计数器，await 后检查 mySeq !== startSeq 则提前 return。配合 mountedRef.current 防止组件卸载后 setState。

### Suggested Action
所有"用户可重复触发的异步流程"都应有取消机制：序列号（轻量）或 AbortController（可中断 fetch）。

### Metadata
- Source: code-review
- Related Files: src/hooks/useFlow.ts
- Tags: async, race-condition, cancellation, react-hooks, p1

---

## [LRN-20260704-012] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
Tauri command 不能用 std::sync::mpsc 阻塞主线程等待回调，必须改为 async + tokio::sync::oneshot

### Details
P1-3 Bug 修复：pick_project_folder 原先用 std::sync::mpsc::channel + rx.recv() 阻塞等待 dialog 回调，会卡死 Tauri 主线程（dialog 事件也在主线程派发）。改为 async fn + tokio::sync::oneshot::channel + rx.await，Cargo.toml 新增 tokio = { version = "1", features = ["sync"] }。

### Suggested Action
所有 Tauri command 凡需等待异步回调（dialog、文件选择、窗口事件）都必须用 async + tokio::sync::oneshot 或 tauri::async_runtime。

### Metadata
- Source: code-review
- Related Files: src-tauri/src/lib.rs, src-tauri/Cargo.toml
- Tags: tauri, async, deadlock, main-thread, tokio, p1

---

## [LRN-20260704-013] best_practice

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
用户交互回调中的 async 操作必须有 try/catch + UI 错误提示，否则异常会静默丢失

### Details
P1-6 修复：QuestionPanel 的 handleOption/handleSkip/handleFinishEarly 原先直接 await answer(...) 无 catch，answer 抛错时 answering state 卡在 true，按钮永久禁用。新增 errorMsg state + catch 块 + 顶部红色错误提示条。

### Suggested Action
所有 await 异步操作的 React 事件处理器都应有 try/catch/finally：catch 设置错误 state，finally 复位 loading state。

### Metadata
- Source: code-review
- Related Files: src/components/QuestionPanel.tsx
- Tags: react, error-handling, ux, async, p1

---

## [LRN-20260704-014] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: security

### Summary
read_image_file 必须移除 SVG 支持，且敏感文件检测要拆分"后缀匹配"和"路径分段精确匹配"

### Details
P2-2 + P3-1 修复：① SVG 即使作为 data URL 也可触发 XSS（未来若改用 inline 渲染），直接禁用。② is_sensitive_file 原先用 SENSITIVE_PATTERNS.iter().any(|p| name.contains(p))，".env" 会误匹配 "my.env.config"，而 ".ssh/rsa" 永远不会匹配（file_name 不含分隔符）。拆分为 SENSITIVE_EXT_PATTERNS（后缀匹配）+ SENSITIVE_NAME_PATTERNS（路径分段精确匹配）。

### Suggested Action
敏感文件匹配要区分"后缀"和"完整文件名"两种语义；不信任的图片格式直接禁用而非尝试 sanitize。

### Metadata
- Source: code-review
- Related Files: src-tauri/src/lib.rs, src/hooks/useTauriDropFile.ts
- Tags: security, svg, xss, sensitive-files, path-matching, p2, p3

---

## [LRN-20260704-015] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: security

### Summary
Tauri capabilities/default.json 必须按最小权限原则，移除非必需的 fs:allow-* 权限

### Details
P2-6 修复：default.json 原先包含 fs:allow-mkdir 和 fs:allow-write-file，但应用业务逻辑通过自定义 Tauri command（save_context 等）写文件，不应直接暴露通用 fs 写权限给前端。移除这两个权限。

### Suggested Action
前端需要的文件操作都通过自定义 command 封装（可在后端做路径校验），不要把通用 fs 权限直接给 webview。

### Metadata
- Source: code-review
- Related Files: src-tauri/capabilities/default.json
- Tags: security, tauri, capabilities, least-privilege, p2

---

## [LRN-20260704-016] best_practice

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
LLM 错误信息抛出前必须 sanitize，避免 API Key 泄露到 UI/console

### Details
P3-2 修复：openai-adapter.ts 的 chat/chatStream 抛错时直接透传 fetch 的 err.text()，部分代理会回显请求头中的 Authorization Bearer xxx。新增 sanitizeErrorText 函数，用正则把 sk-xxx 和 Bearer xxx 截断为前 6 位 + ***。

### Suggested Action
所有外部 API 错误信息在抛给 UI 前都应过滤敏感模式（sk-、Bearer、token= 等）；errText 仅截取前 200 字符避免日志膨胀。

### Metadata
- Source: code-review
- Related Files: src/lib/llm/openai-adapter.ts
- Tags: security, error-sanitization, api-key, llm, p3

---

## [LRN-20260704-017] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: backend

### Summary
API Key 写入 keyring 前必须校验长度和字符集，避免异常输入导致 keyring 持久化失败

### Details
P3-2 修复：lib.rs save_api_key 原先直接 entry.set_password(&api_key)，超长或含控制字符的输入会导致 keyring 写入失败且错误信息不友好。新增 validate_api_key 函数：非空、≤1024 字节、仅可见 ASCII + 空格。

### Suggested Action
所有写入系统凭据存储的输入都应先做长度+字符集校验；错误信息要友好（不要泄露底层系统调用细节）。

### Metadata
- Source: code-review
- Related Files: src-tauri/src/lib.rs
- Tags: security, api-key, keyring, input-validation, p3

---

## [LRN-20260704-018] best_practice

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: frontend

### Summary
所有空 catch 块必须至少 console.warn，否则排查问题时完全无从下手

### Details
P3-1/P3-2/P3-3 修复：useDrag.ts（3 处）、sqlite.ts（writePromptHistoryToStorage）、contextStore.ts（readPersisted/writePersisted/archiveCtx）原先都是 `catch {}` 或 `catch (e) {}` 静默吞错。统一补全为 console.warn('[模块名] 操作描述', e)。

### Suggested Action
项目 lint 规则可加 no-empty-pattern 或自定义 rule 禁止 `catch {}`；至少要 console.warn 标注模块和操作。

### Metadata
- Source: code-review
- Related Files: src/hooks/useDrag.ts, src/lib/sqlite.ts, src/stores/contextStore.ts
- Tags: error-handling, logging, debuggability, p3

---

## [LRN-20260704-019] correction

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: frontend

### Summary
SQLite 连接失败时必须重置 dbInstance/dbPromise，否则后续调用永远拿到坏连接

### Details
P3-4 修复：sqlite.ts getDb 原先 catch 中只 return null，dbPromise 仍指向失败 promise，下次调用直接返回失败结果。改为 catch 中清空 dbPromise = null 允许重试；新增 executeSql 辅助函数，执行失败时重置 dbInstance/dbPromise 让下次重连。

### Suggested Action
所有缓存的连接/资源在出错时都应主动失效缓存，让下次调用重新初始化；不要让一次失败永久阻塞后续重试。

### Metadata
- Source: code-review
- Related Files: src/lib/sqlite.ts
- Tags: sqlite, connection-retry, cache-invalidation, p3

---

## [LRN-20260704-020] insight

**Logged**: 2026-07-04T00:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
TRAE IDE 内置终端 PATH 缺失 node/npx，需用 Adobe 自带 node.exe 或外部 PowerShell 验证

### Details
本次验证阶段发现 TRAE 内置 PowerShell 执行 `npx vitest`/`node vite build` 都报 "not recognized"。最终用 `& "C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe" node_modules/vitest/vitest.mjs` 成功运行（node v20.18.0）。该路径下 node 可独立执行 npm 包的 .mjs/.js 入口。

### Suggested Action
TRAE 内置终端跑前端命令前先 `where.exe node` 验证；若缺失，可借用 Adobe/VSCode 等捆绑的 node.exe，或在外部 PowerShell 执行。

### Metadata
- Source: error
- Tags: trae, terminal, node, path, adobe, tooling
