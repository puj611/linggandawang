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
