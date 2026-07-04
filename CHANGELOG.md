# 变更日志

本文件记录灵感大王项目的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

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
