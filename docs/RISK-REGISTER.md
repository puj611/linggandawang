# 风险登记册（RISK-REGISTER）

> 本文件记录灵感大王项目已识别、已修复、待跟踪的风险项。
> 目标：确保已修复的风险不再复发，并预防潜在风险。
> 维护规则：每次风险评估与修复后更新，新增风险追加到末尾，已修复风险更新状态但不删除（保留历史）。

## 风险等级定义

| 等级 | 含义 | 响应时效 |
|------|------|----------|
| **P0** | 阻塞性问题，影响核心功能 | 立即修复 |
| **P1** | 高危问题，影响稳定性/安全 | 本迭代修复 |
| **P2** | 中危问题，影响质量/性能 | 下个迭代修复 |
| **P3** | 低危问题，改善性优化 | 排期修复 |

## 已修复风险（r6-r13 批次，2026-07-01）

### R-001: LLM 请求超时不生效 [P0] ✅
- **症状**: LLMIntentAnalyzer/SmartFollowup 创建了 AbortController 但未将 signal 传入 adapter.chat()，8s 超时形同虚设
- **根因**: LLMAdapter 接口的 chat/chatStream/testConnection 方法未接受外部 signal 参数
- **修复**: 扩展 LLMAdapter 接口 + OpenAICompatibleAdapter 实现外部 signal 联动 + 3 个调用方传入 controller.signal
- **验证**: tsc 通过 + vitest 通过
- **防复发**: normalize.test.ts 覆盖归一化逻辑；LLMAdapter 接口已固化 signal 参数

### R-002: 竞态/卸载后 setState [P0] ✅
- **症状**: useFlow answer() 中 await 后 setState 无卸载保护；ExpandedCard 3 处 async 操作无 mountedRef
- **修复**: useFlow + ExpandedCard 添加 mountedRef，await 后检查 mountedRef.current
- **验证**: tsc 通过 + vitest 通过
- **防复发**: AGENTS.md 编码规范明确要求"async 操作 await 后检查 mountedRef.current"

### R-003: skip() 未 await finishAndGenerate [P1] ✅
- **症状**: skip() 是同步函数，未 await finishAndGenerate()，跳过后状态可能不一致
- **修复**: skip() 改为 async + await finishAndGenerate() + mountedRef 检查

### R-004: Zustand 整 store 订阅导致重渲染 [P2] ✅
- **症状**: 4 个组件使用 `useStore()` 整 store 订阅，任何 state 变化都触发重渲染
- **修复**: 改为逐个 selector 或 useShallow 选 actions 对象
- **防复发**: AGENTS.md 编码规范明确要求"禁止整 store 订阅"

### R-005: App.tsx 启动瀑布 [P2] ✅
- **症状**: 8 个 load 操作串行 await，启动耗时为各 load 之和
- **修复**: 改为 Promise.allSettled 并行，耗时降为最大值

### R-006: read_image_file 敏感文件校验缺失 [P1] ✅
- **症状**: read_image_file 仅检查 BLOCKED_PATHS，未校验文件名，用户可把 .env 改名为 .png 拖入读取
- **修复**: 新增 is_sensitive_file 校验，与 scan_project 的 SENSITIVE_PATTERNS 统一
- **防复发**: AGENTS.md 已知坑点记录

### R-007: fs:allow-remove 权限过宽 [P2] ✅
- **症状**: capabilities/default.json 包含 fs:allow-remove，前端不直接使用
- **修复**: 移除该权限

### R-008: LLM 输出归一化使用 any [P2] ✅
- **症状**: normalizeOutput/normalizeAnalysis 参数为 any，无类型安全
- **修复**: 改为 unknown + Record<string, unknown> 类型守卫
- **防复发**: normalize.test.ts 22 个测试用例覆盖；AGENTS.md 编码规范明确要求"LLM 输出归一化函数参数用 unknown"

### R-009: 剪贴板 API 无 fallback [P2] ✅
- **症状**: ImageExtractResult.handleCopy 直接 await navigator.clipboard.writeText，非安全上下文下会抛错
- **修复**: 添加 textarea + execCommand fallback + copyTimerRef cleanup
- **防复发**: AGENTS.md 编码规范明确要求"剪贴板操作必须有 textarea fallback"

### R-010: projectStore unhandled rejection [P2] ✅
- **症状**: projectStore load/setFingerprint/clear 无 try/catch，持久化失败时 unhandled rejection
- **修复**: 添加 try/catch + console.warn

### R-011: 未使用依赖膨胀包体积 [P3] ✅
- **症状**: clsx/marked/puppeteer-core 未被使用但仍在 package.json
- **修复**: 移除 3 个依赖，减少 23 个包

## 待跟踪风险

### R-012: CSP connect-src 'https:' 范围较宽 [P3] 📋
- **状态**: 已知风险，接受
- **描述**: 为支持自定义 LLM baseUrl，CSP connect-src 保持 'https:'，未限制具体域名
- **缓解**: validateBaseUrl 已做 SSRF 防护（拒绝内网地址）
- **后续**: 如需收紧，可在设置页让用户显式添加信任域名

### R-013: uuid/vite/vitest 跨主版本升级 [P3] 📋
- **状态**: 推迟
- **描述**: uuid 9→10、vite 5→6、vitest 1→2 均为主版本升级，可能引入 breaking change
- **建议**: 单独排期，升级后全量回归测试

### R-014: useFlow/ImagePromptExtractor 测试覆盖不足 [P2] 📋
- **状态**: 待补充
- **描述**: 涉及 Tauri invoke mock，复杂度高，r13 未覆盖
- **建议**: 后续迭代补充，可参考 normalize.test.ts 的 mock 模式

### R-015: tauri.conf.json productName 为 'linggandawang' [P3] 📋
- **状态**: 待修复（r15）
- **描述**: productName 应为中文 '灵感大王' 或保持一致命名

## 风险预防机制

### 1. 编码规范固化
- 所有 r6-r13 修复涉及的编码规范已写入 AGENTS.md
- 新代码必须遵循：unknown > any、mountedRef、useShallow、try/catch

### 2. 测试回归保护
- normalize.test.ts 保护 LLM 输出归一化逻辑
- 后续新增 engine 模块必须配套测试

### 3. 验证清单（每次提交前）
```
npx tsc --noEmit     # 类型检查
npx vitest run       # 单元测试
cd src-tauri && cargo check  # Rust 编译检查
```

### 4. 依赖审计（每月）
- 运行 `npm audit` 检查已知漏洞
- 检查未使用依赖：`npx depcheck`
- 评估是否升级跨主版本依赖

---

*最后更新: 2026-07-01 (r6-r13 修复完成)*
