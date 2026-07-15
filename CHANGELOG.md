# 变更日志

本文件记录灵感大王项目的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

## [0.3.0] - 2026-07-15 - M11 需求同步器

### 新功能（需求同步器）
- **RequirementSyncer 核心引擎**（`src/engine/RequirementSyncer.ts`）：LLM + 规则双模式需求拆解，支持降级
- **LLM 需求拆解 prompt**（`src/engine/prompts/requirement-decompose.ts`）：结构化 JSON 输出，含子任务类型/优先级/依赖/提示词建议
- **需求持久化**（`src/stores/requirementStore.ts`）：Zustand store + Tauri JSON / localStorage 双存储
- **Rust 后端命令**（`src-tauri/src/lib.rs`）：`load_requirements` / `save_requirements` 持久化到 `~/.linggandawang/requirements.json`
- **需求同步面板 UI**（`src/components/RequirementSyncPanel.tsx`）：输入需求→LLM拆解→子任务列表→状态管理→进度追踪→聚焦提示词生成
- **ProjectPanel 集成**：项目面板新增「📋 需求」按钮入口

### 子任务管理
- 状态流转：pending → in_progress → done / blocked / skipped
- 自动解锁：依赖任务完成后自动将 blocked 改为 pending
- 优先级排序：P0 > P1 > P2，同优先级按预估工时排序
- 聚焦提示词：基于当前子任务生成针对性的动作段/规格段/约束段/验证段

### 类型定义
- `src/types/requirement.ts`：Requirement / Subtask / SubtaskStatus / SubtaskPriority / SubtaskType / RequirementFilter

### 验证
- tsc --noEmit：0 错误
- vitest run：167/167 通过
- vite build：成功（385KB JS / 34KB CSS）
- cargo check：通过（0 errors，2 pre-existing warnings）

## [0.4.0] - 2026-07-15 - M12 阶段二集成 + QA

### 问题库扩充（T12.2）
- **从 31 条扩充到 45 条**，新增 14 条覆盖缺失场景
- **新增 perceive 3 条**：无障碍需求（p-007）、加载速度期望（p-008）、时间压力（p-009）
- **新增 name 3 条**：加载慢类型（n-008）、图标问题（n-009）、空状态/加载态（n-010）
- **新增 spec 4 条**：动画速度（s-009）、图标风格（s-010）、正文字号（s-011）、行高（s-012）
- **新增 execute 2 条**：测试需求（e-006）、部署需求（e-007）
- **新增 verify 2 条**：性能验证（v-006）、无障碍验证（v-007）

### 视觉打磨（T12.3）
- **CSS 动画工具类**：animate-fade-in / animate-slide-up / animate-pulse-soft（`index.css`）
- **空状态升级**：QuestionPanel / ResultPanel 加载态增加脉冲光圈 + 描述文案
- **StartTemplates 动画**：模板按钮入场动画 + 图标 + 悬停阴影增强
- **ProjectOnboarding 动画**：入场滑入动画 + 图标脉冲效果

### 测试更新
- QuestionLoader.test.ts：更新分布断言为新题库数量（9/10/12/7/7）

### 验证
- tsc --noEmit：0 错误
- vitest run：167/167 通过
- vite build：成功（394KB JS / 34KB CSS）

## [0.5.0] - 2026-07-15 - M13 最终冻结

### 性能测试（T13.1）
- **cargo check**：2.2s（< 10s ✓）
- **tsc --noEmit**：3.3s（< 10s ✓）
- **vitest run**：4.0s，167/167 通过（< 10s ✓）
- **vite build**：1.5s，394KB JS / 34KB CSS（< 10s ✓）

### 安全审计（T13.2）
- **硬编码密钥扫描**：无生产代码泄露（仅测试 fixture 中的 mock key）
- **XSS 防护**：无 eval / innerHTML / dangerouslySetInnerHTML
- **路径遍历防护**：canonicalize() 解析符号链接 + starts_with() 白名单校验
- **敏感文件跳过**：.env / .pem / .key / id_rsa 等 30+ 种敏感文件名/扩展名黑名单
- **SSRF 防护**：IPv4/IPv6 内网地址归一化拒绝 + HTTP 仅允许 localhost
- **API Key 脱敏**：sanitizeErrorText 正则脱敏 sk-* 和 Bearer Token
- **CSP 收紧**：Content-Security-Policy 限制 script-src / connect-src

### 最终冻结（T13.3）
- TypeScript 编译：0 错误
- 单元测试：167/167 通过
- 生产构建：成功（394KB JS / 34KB CSS，gzip 后 127KB / 7KB）
- 问题库：45 条（perceive 9 / name 10 / spec 12 / execute 7 / verify 7）
- 复赛交付就绪

## [0.6.0] - 2026-07-15 - P0 代码体检整改

### P0-1: ESLint 工具链补齐
- **安装 ESLint**：eslint + @typescript-eslint/parser + @typescript-eslint/eslint-plugin + eslint-plugin-react-hooks + eslint-plugin-react-refresh
- **eslint.config.js**：flat config 格式，配置 TypeScript + React Hooks + 命名导入规则
- **lint 脚本更新**：`eslint src/` 替代旧的 `eslint . --ext ts,tsx`
- **修复 QuestionPanel hooks 错误**：useState 在条件返回后调用（React Hooks 规则违反），移至组件顶部

### P0-2: 单元测试补齐
- **seedRouter 测试**（29 用例）：detectNegation / detectScene / matchAdjectiveClusters / aggregateTagScores / routeSeedWithClusters
- **RequirementSyncer 测试**（16 用例）：decomposeLocal / updateSubtaskStatus / getNextSubtask / getProgress
- **测试总数**：167 → 212（+45）

### P1 清理
- **删除 17 个 .bak 备份文件**（src/components/ / src/engine/ / src-tauri/ / docs/）
- **删除 seedRouter 死代码**：`topTagScores` 函数（exported but never called）
- **修复 build-release.ps1**：硬编码绝对路径 → `$PSScriptRoot` 相对路径
- **新增 LICENSE**：MIT 全文 + copyright 2026

### 验证
- tsc --noEmit：0 错误
- vitest run：212/212 通过
- npm run lint：通过（30 warnings，0 errors）

## [0.7.0] - 2026-07-15 - 智能化升级：RAG+向量检索

### RAG-Lite 向量存储（方案 F）
- **@xenova/transformers 集成**：本地嵌入模型 all-MiniLM-L6-v2（~90MB，CPU 可跑）
- **vectorStore.ts**（`src/lib/vectorStore.ts`）：嵌入/余弦相似度/索引/检索/持久化
- **useVectorStore hook**（`src/hooks/useVectorStore.ts`：管理向量存储生命周期 + 检索接口
- **PromptGenerator 增强**：动作段注入向量检索到的相似历史 QA（跨会话连续性）
- **useFlow 集成**：finishAndGenerate 时异步检索相似历史，失败时优雅降级

### 新增能力
- 跨会话上下文复用：用户上次处理"圆角"时选了 8px，这次检索到后自动注入动作段
- 避免重复提问：相似历史 QA 以"历史上相似的需求处理方式"格式呈现
- 本地隐私安全：嵌入模型运行在浏览器端，数据不出机器

### 技术细节
- 嵌入维度：384（all-MiniLM-L6-v2）
- 相似度阈值：0.3（低于不返回）
- 检索条数：默认 Top-3（仅 score > 0.4 的注入提示词）
- 最大存储：200 条（超限裁剪最旧）
- 持久化：localStorage（仅元数据，向量重建）

### 验证
- tsc --noEmit：0 错误
- vitest run：217/217 通过
- 新增 vectorStore 测试 5 用例（cosineSimilarity 边界）

## [0.8.0] - 2026-07-15 - 智能化升级：规则模板库 + 行为学习

### 规则模板库（方案 B）
- **TemplateRetriever**（`src/engine/TemplateRetriever.ts`）：10 套预置场景模板
- 覆盖场景：修间距/圆角/配色/字体/极简风格/科技风格/hover反馈/加载状态/对比度/复制特性
- 检索逻辑：种子标签匹配(50%) + 意图标签匹配(30%) + 历史匹配(10%) + 人气权重(10%)
- 阈值：score > 0.15 返回最佳模板

### 行为学习（方案 D）
- **PreferenceLearner**（`src/engine/PreferenceLearner.ts`）：用户偏好挖掘
- 频率统计：每题最常选的选项 + 一致性比例
- 模式挖掘：高频(≥3次)高一致性(≥70%)的偏好模式
- 推荐引擎：recommendAnswers() 基于画像预填 + recommendFromPreferences() 基于偏好数组预填

### 测试
- TemplateRetriever 测试 12 用例（retrieve/retrieveTopK/getById/getAll）
- PreferenceLearner 测试 9 用例（extract/buildProfile/recommend）
- 测试总数：217 → 238（+21）

### 验证
- tsc --noEmit：0 错误
- vitest run：238/238 通过

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
