# 变更日志

本文件记录灵感大王项目的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

## [0.2.0] - 2026-07-04 - LLM 稳定性 + 快速提问增强 + 全面 bug 修复

### 新功能（LLM 稳定性层）
- **会话级熔断器**（`llmAvailabilityStore`）：状态机 unknown→available→degraded，按错误类型分级熔断时长，半开探测机制
- **7 种错误分类中文提示**（`error-messages.ts`）：auth/rate_limit/server/network/timeout/bad_request/unknown，每种含 retryable 标志、中文提示、排查建议
- **指数退避重试**（`withRetry.ts`）：最大 2 次重试，间隔 1s/3s，仅重试可恢复错误
- **API Key 脱敏**（`sanitizeErrorText`）：正则匹配 sk- 前缀和 Bearer Token，防止泄露到 UI/日志
- **baseUrl SSRF 防护**（`validateBaseUrl`）：IPv4/IPv6 内网地址、十进制/十六进制/八进制 IPv4 归一化、IPv4-mapped IPv6 拒绝

### 新功能（基础模式增强 - 不配置 LLM 也更智能）
- **否定词识别**：seedRouter 处理"不要/别/无需"等否定表述，反选标签
- **规则追问兜底**：高歧义场景下规则引擎生成追问建议
- **answers 反向更新选题**：用户回答后反向调整后续选题权重
- **上下文加权**：recentQA 历史影响选题评分

### 新功能（快速提问优化）
- **verify 阶段补题**：v-001（验收方式）、v-005（回退策略）、b-020（后端验收）标记 quick_mode，快速模式不再跳过验证标准
- **SmartFollowup 排除 quick**：快速模式不触发 LLM 动态追问，避免计划外问题
- **模式记忆**：localStorage 持久化用户选择的提问模式（key: `linggan_flow_mode`）
- **LLM 快速通道**：quick 模式下 LLM 分析超时从 8s 降到 4s，更快降级到规则路由
- **PromptGenerator 感知 mode**：quick 模式下 verify 段无答案时，基于种子关键词自动推断验证标准（间距/对比度/圆角/字号/响应式/动画）
- **UI 文案动态化**：快速模式题数从硬编码"7 道"改为 useMemo 从问题库动态计算

### Bug 修复
- **sanitizeErrorText 正则贪婪匹配**：原 `{6,}` 贪婪匹配把整个 key 都进第一组导致脱敏失效，改为第一组固定 sk-+4 字符
- **validateBaseUrl 误拦 HTTP 127.0.0.1**：HTTP 协议检查放行 127.0.0.1 后，IPv4 内网检查又拒绝，添加 isHttpLoopback 跳过
- **apiKeyStore localStorage 降级**：浏览器模式下 localStorage fallback 替代仅支持 Tauri Credential Manager 的存储方案，Web Demo 用户可配置 LLM
- **会话状态残留**：useFlow.start 中添加 ctxStore.clear()，新会话不继承旧状态
- **25 道题缺少 why-ask**：bank.yaml 补充 why 字段
- **浏览器模式隐藏非功能按钮**：isTauri() 检查隐藏桌面端独有功能
- **SQLite migration schema drift**：0004 migration 补充缺失的 favorite 列

### 安全修复
- **SSRF IPv4 归一化防护**：拒绝十进制/十六进制/八进制编码的内网地址
- **CSP 收紧**：Content-Security-Policy 更严格
- **API Key 存储**：浏览器模式从 localStorage 改为 sessionStorage（关闭浏览器即清除）

### 测试
- 新增 5 个测试文件：error-messages/withRetry/llmAvailabilityStore/openai-adapter/LLMIntentAnalyzer/SmartFollowup
- 新增 114 个测试用例，测试总数从 53 增至 167
- 覆盖：错误分类、重试逻辑、熔断器状态机、适配器超时/安全/脱敏、LLM 降级、SmartFollowup 模式排除、Selector quickMode

### 验证
- tsc --noEmit：0 错误
- vitest run：167/167 通过
- vite build：成功（349KB JS / 30KB CSS）

## [0.1.1] - 2026-07-01 - 风险评估与修复（r6-r13）

### 安全修复
- **read_image_file 统一敏感文件校验**：与 scan_project 的 SENSITIVE_PATTERNS 一致，防止用户把 .env/id_rsa 等敏感文件改名为 .png 后通过拖入读取
- **移除 fs:allow-remove 权限**：前端不直接使用 fs remove，减少攻击面

### 性能修复
- **vite manualChunks 拆包**：拆分 react-vendor / zustand-vendor，利用浏览器缓存减少主包体积
- **App.tsx 启动并行化**：8 个串行 await load 改为 Promise.allSettled 并行，启动耗时从各 load 之和降为最大值
- **Zustand 订阅优化**：4 个组件从整 store 订阅改为逐个 selector，useFlow 用 useShallow 选 actions，减少不必要的重渲染
- **ResultPanel setTimeout 清理**：copyTimerRef + useEffect cleanup，避免组件卸载后 setState
- **ExpandedCard 卸载保护**：mountedRef 保护 3 处 async 操作（diagnose/extract/droppedImage）await 后的 setState

### Bug 修复
- **H1 AbortController 未传入 adapter**：LLMIntentAnalyzer/SmartFollowup/ImagePromptExtractor 的 controller.signal 现已正确传入 LLMAdapter.chat()，超时机制实际生效
- **H2 竞态/卸载后 setState**：useFlow answer() 中两个 await 后加 mountedRef 检查
- **H3 skip 未 await finishAndGenerate**：skip() 改为 async + await，确保跳过后状态一致

### 代码质量
- **LLM 输出归一化 any→unknown**：normalizeOutput / normalizeAnalysis 参数从 `any` 改为 `unknown` + 类型守卫
- **ImageExtractResult 剪贴板 fallback**：clipboard API 失败时降级到 textarea + execCommand
- **projectStore 错误兜底**：load/setFingerprint/clear 添加 try/catch + console.warn，防止 unhandled rejection

### 依赖清理
- 移除未使用依赖：clsx、marked、puppeteer-core（共减少 23 个包）

### 测试
- 新增 normalize.test.ts：22 个测试用例覆盖 normalizeOutput / normalizeAnalysis
- 测试总数从 31 增至 53

### 验证
- tsc --noEmit：通过
- vitest run：53/53 通过
- cargo check：通过

## [0.1.0] - 初始版本

- Tauri 2.0 + React 18 + TypeScript 桌面浮窗工具
- 反向提问引擎（31 道结构化问题 + LLM 动态追问）
- 截图诊断 + 图片提示词拆解
- SQLite 持久化 + keyring 密钥存储
- 项目指纹扫描
