# Tasks

## Phase 0：清债（先做，均为小改动，可并行）

- [x] Task 1: 剔除生产调试上报（S1）
  - [x] 1.1 debugReporter.ts 按 `import.meta.env.DEV` 短路（上报函数 no-op）
  - [x] 1.2 tauri.conf.json CSP 移除 `http://127.0.0.1:7777`
  - [x] 1.3 验证：release 构建无 7777 请求（DevTools Network）→ 已验证：vite 生产构建 dist/assets/*.js grep "7777" 零命中（DEV 短路被 tree-shake）
- [x] Task 2: 收窄 capability（S3）
  - [x] 2.1 capabilities/default.json 移除 `fs:allow-read-file`/`fs:allow-read`/`fs:allow-read-dir` 等 WebView 未用项
  - [x] 2.2 cargo check + 手动回归：项目扫描、图片读取（走 Rust 命令）不受影响
- [x] Task 3: 处理死代码（C1/C3）
  - [x] 3.1 SettingsPanel 暴露 screenshotAdvanced 开关（或删除该 feature 项，二选一）
  - [x] 3.2 PreferenceLearner 文件头标注「Phase 2 待接线」
- [x] Task 4: 缩放 rAF 节流（P3）
  - [x] 4.1 useResize.ts pointermove 中 setState/applyToWindow 合并进 requestAnimationFrame，仅应用最新值
  - [x] 4.2 回归：拖边缩放跟手；tsc + vitest 通过
- [x] Task 5: 补齐文档
  - [x] 5.1 tauri-commands.md 补齐全部 28 个命令（现缺 12）
  - [x] 5.2 llm-adapter.md 对齐 6 provider 现状与重试已实现事实
  - [x] 5.3 创建 .trae/rules/（沉淀引擎层依赖 store 的既有偏差说明）

## Phase 1：目标工具适配（借鉴 Prompt Master 已验证需求）

- [x] Task 6: 工具 profile 数据结构
  - [x] 6.1 定义 TargetTool 类型与 profile 配置（claude-code/cursor/copilot/codex/generic）
  - [x] 6.2 每个 profile 定义结构差异（Claude Code 用 XML 标签；Cursor 含文件路径占位 + 任务分步 + stop 条件；Codex 侧重任务规格；generic 保持现状）
- [x] Task 7: PromptGenerator 支持工具定制
  - [x] 7.1 generate() 接受 targetTool 参数，按 profile 调整段落结构与措辞
  - [x] 7.2 单测：同一 answers 输入不同 tool 产出结构差异断言
- [x] Task 8: UI 接入
  - [x] 8.1 ExpandedCard 场景选择旁新增「目标工具」选择（默认通用）
  - [x] 8.2 appStore 持久化选择（localStorage）
- [x] Task 9: token 审计提示（轻量版）
  - [x] 9.1 ResultPanel 显示估算 token 数（字符数/4）
  - [x] 9.2 超过 2000 token 显示精简建议

## Phase 2：智能接线

- [x] Task 10: RAG 全局初始化（C2）
  - [x] 10.1 App.tsx 挂载 useVectorStore（而非仅 SettingsPanel）
  - [x] 10.2 模型懒加载：首次生成时才加载 embedding 模型
  - [x] 10.3 验证：不打开设置面板，历史 QA 检索返回非空
- [x] Task 11: PreferenceLearner 接入（C1）
  - [x] 11.1 start() 后对 currentQuestion 匹配 recommendAnswers，命中项在 QuestionPanel 显示「历史推荐」角标
  - [x] 11.2 单测：偏好命中与不命中两场景
- [x] Task 12: 向量存储性能（P1/P2）
  - [x] 12.1 persistVectorStore 改事务批量 INSERT（拼接 VALUES 每批 40 行）
  - [x] 12.2 restoreVectorStore 持久化向量本体，冷启动跳过重嵌入

## Phase 3：效率入口

- [x] Task 13: 全局热键
  - [x] 13.1 Rust global-shortcut 插件注册（复用现有设置热键 UI，扩展为全局）
  - [x] 13.2 热键触发 → 窗口置顶展开 + 聚焦输入
- [x] Task 14: 复制增强与 UX 补齐
  - [x] 14.1 复制按钮支持「按目标工具格式」（联动 Task 8 profile）
  - [x] 14.2 删除历史确认对话框 + 清空历史批量操作

## Phase 4：MCP server（新分发渠道）

- [x] Task 15: MCP server 骨架
  - [x] 15.1 技术选型：手写 JSON-RPC stdio（npm 不可用，零新增依赖）+ vite lib 预构建复用 TS 引擎
  - [x] 15.2 实现 stdio server：list_tools + generate_prompt（入参：需求描述、target_tool、可选场景）
  - [x] 15.3 生成逻辑复用：无 key 走规则引擎（保留免 key 优势）
- [x] Task 16: MCP 集成验证
  - [x] 16.1 Claude Code / Cursor 连接配置文档（docs/reference/mcp-server.md）
  - [x] 16.2 MCP Inspector 冒烟测试（smoke-test.mjs 真子进程 9/9 断言）
  - [x] 16.3 README 增加 MCP 安装章节（并入 Task 17 README）

## Phase 5：发布就绪

- [x] Task 17: 开源准备
  - [x] 17.1 README 中英双语（定位/截图/安装/竞品对比表/与 prompt-optimizer·Prompt Master 差异）
  - [x] 17.2 MIT LICENSE、CONTRIBUTING
  - [x] 17.3 GitHub Actions 三平台构建（windows/macos/linux）
- [x] Task 18: 自动更新
  - [x] 18.1 Tauri updater 插件接入（签名密钥生成与保管）
  - [x] 18.2 latest.json 发布流程脚本

## Backlog（观察后决定）
- 文档上传解析（PDF/DOCX → 参考图/上下文，prompt-iterator 已有）
- 浏览器插件形态（prompt-optimizer 33.2k stars 验证的市场，但与桌面定位有差异）
- 前后对比 UI（优化前后 diff 视图）
- spec/plan 分层产物导出（Spec Kit 思路，输出升级为多文件）

# Task Dependencies
- Task 1-5 相互独立，可并行
- Task 6→7→8→9 顺序依赖（Phase 1 内）
- Task 10/11/12 相互独立，可并行（依赖 Phase 0）
- Task 14.1 依赖 Task 8
- Task 15 依赖 Phase 1（generate_prompt 复用工具 profile）
- Task 18 依赖 Task 17（CI 先行）
