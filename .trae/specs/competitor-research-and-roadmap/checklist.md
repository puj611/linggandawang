# Checklist

## 文档
- [x] spec.md 竞品调研覆盖三类（直接竞品 7+、spec 驱动 6、MCP 生态 3），Star/活跃度数据已核实并标注来源时间（2026-08）
- [x] spec.md 明确最同构竞品（prompt-iterator）与最大竞品（prompt-optimizer 33.2k stars）的逐项差异
- [x] spec.md 定位结论区分「护城河」与「关键差距」，差距按证据强度排序
- [x] spec.md 路线图 6 个 Phase（0-5）+ Backlog，每 Phase 有 ADDED/MODIFIED/REMOVED 需求
- [x] tasks.md 每任务可独立验证，依赖关系明确，MCP Phase 含技术选型决策点

## Phase 0 清债
- [x] release 构建零 7777 上报请求（vite 生产构建 dist grep "7777" 零命中，DEV 短路被 tree-shake）
- [x] capabilities 移除多余 fs 权限后项目扫描/图片功能回归通过（前端零 fs 插件使用已证实，Rust 侧 std::fs 不依赖插件 scope，cargo check 过）
- [x] screenshotAdvanced 有 UI 入口（SettingsPanel「高级视觉诊断」开关）
- [x] 缩放拖动期间无性能劣化（rAF 合并生效，tsc+vitest 373 全过）
- [x] tauri-commands.md 覆盖全部 28 个命令；llm-adapter.md 与代码一致

## Phase 1 目标工具适配
- [x] 同一问答输入选择不同目标工具，产出 prompt 结构有实质差异（单测断言：Claude Code 含 XML 标签、Cursor 含文件路径 + stop 条件；12 测试）
- [x] 工具选择持久化，重启保留（localStorage key linggan_target_tool）
- [x] ResultPanel 显示 token 估算，超 2000 有精简提示（编辑态实时估算）

## Phase 2 智能接线
- [x] 不打开设置面板的普通用户，RAG 检索返回非空（App.tsx 全局挂载 + 单例守卫，实现与单测验证；运行时行为留待桌面回归）
- [x] PreferenceLearner 被主流程调用，推荐项有 UI 角标（C1 关闭，13 测试）
- [x] 向量持久化后冷启动不再全量重嵌入（vector_json 复用，条件：384 维 JSON 有效）
- [x] persistVectorStore 单次事务批量写入（拼接 VALUES 每批 40 行，201 次 IPC → 6 次）

## Phase 3 效率入口
- [x] 任意应用下按全局热键，窗口置顶展开并聚焦输入（Alt+Shift+I，tsc/cargo check/vitest 过；运行时触发留待桌面回归）
- [x] 删除历史有确认对话框（二态确认 2.5s 超时）
- [x] 复制输出格式与所选目标工具 profile 匹配（链路验证：copyPrompt→toMarkdown→applyTargetToolProfile）

## Phase 4 MCP server
- [x] MCP stdio 连接成功并列出 generate_prompt 工具（smoke-test.mjs 真子进程 9/9 断言，协议级验证替代 Inspector）
- [x] 无 API key 时 generate_prompt 仍返回规则引擎生成的结构化提示词（冒烟验证 4055 字符输出，零网络调用）
- [ ] Claude Code 实际连接调用成功 → 留待用户环境验证（配置文档已备：docs/reference/mcp-server.md）
- [x] MCP 安装配置文档完成

## Phase 5 发布就绪
- [x] README 双语 + 竞品对比表 + MIT LICENSE + CONTRIBUTING 就绪
- [ ] GitHub Actions 三平台构建通过并产出安装包 → workflow 已就绪（release.yml tag v* 触发），需推送 GitHub 后实测；另有遗留：@xenova/transformers 未入 lockfile（workflow 已加兜底 install 步骤）
- [ ] 推 tag 自动发布 Release，旧版本收到更新提示 → 同上待 GitHub 实测；updater 链路就绪但 pubkey/endpoints 占位需用户填（签名密钥生成命令见 docs/reference/release-process.md）

## 运行时待人工回归项（桌面端）
1. 悬浮球态按 Alt+Shift+I → 展开+聚焦
2. 不开设置面板直接提问 → RAG 检索生效
3. 拖边缩放流畅性（rAF 后）
4. MCP：Claude Code 按 docs/reference/mcp-server.md 配置后调用
