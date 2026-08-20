# 竞品调研与后续开发路线 Spec（v2 深度版）

## Why
项目核心功能已闭环（问题引导 → 意图分析 → 提示词生成 → 结果编辑导出），近期完成 B1-B6 缺陷修复后进入瓶颈期，缺乏下一阶段清晰方向。通过 GitHub 同类项目深度对比明确差异化定位与路线。

## 竞品调研（2026-08 核实数据）

### A. 直接竞品（同类机制：模糊需求 → 高质量提示词）

#### A1. prompt-iterator（Runa798）——机制最同构的直接竞品
- 形态：Web 应用，中文，MIT
- 机制：**多轮交互式对话 + 多维度选项引导**（角色/受众/深度/格式四维表单）→ 结构化提示词；支持 PDF/DOCX/图片上传解析；模板管理一键复用；键盘快捷键
- 与灵感大王对比：
  - 相同：交互式引导、多维度选项、中文
  - 竞品优势：**文档上传解析**（PDF/DOCX）、模板复用体系、README 完成度高（609 行、双语、功能演示 GIF）
  - 灵感大王优势：**本地规则引擎免 key 可用**（竞品强依赖 LLM）、桌面常驻悬浮球、项目扫描联动、截图诊断、keyring 密钥安全、RAG 历史增强（待接线）

#### A2. prompt-optimizer（linshenkx）——中文市场最大竞品（**33.2k stars**，HelloGitHub 收录）
- 形态：Web + 桌面 + **Chrome 插件** + Docker 四形态，v2.9.3，781 commits，30 贡献者
- 机制：一键优化 + **前后对比测试** + 多轮迭代改进；多模型（OpenAI/Gemini/DeepSeek/自定义）；本地加密存储；**自定义优化模板**（用户评价中「最关键功能」）
- 工程亮点：monorepo（packages 分层）、完整测试基础设施 + E2E、mkdocs 文档站、Vercel 一键部署、曾修复 SSRF 漏洞（与本项目同类安全意识）
- 与灵感大王对比：
  - 竞品优势：**四形态覆盖**（尤其浏览器插件随取随用）、前后对比 UI、自定义模板市场、开源社区运营成熟
  - 灵感大王优势：**追问式澄清**（竞品是无提问的一键改写）、桌面级系统权限（全局热键/剪贴板/文件扫描）

#### A3. Prompt Master（nidhinjs，~10k stars）——管线设计最完整的 skill
- 机制七步管线：工具检测 → 意图 9 维提取（任务/输入/输出/约束/上下文/受众/记忆/成功标准/示例）→ **≤3 个澄清问题** → 12 模板路由（RTF/CO-STAR/RISEN/CRISPE/CoT/Few-Shot/File-Scope/ReAct 等）→ 5 安全技术（o1/o3 类排除 CoT）→ **token 效率审计**（删掉每个不改变输出的词）→ 交付
- **35 个反模式检测**五类：任务（模糊动词/缺成功标准）、上下文（臆测先验知识/幻觉邀请）、格式（缺输出格式）、范围（IDE AI 无文件路径/agent 无 stop 条件）、agentic（无起始状态/文件系统全开）
- 30+ 目标工具 profile：Claude/ChatGPT/Gemini/DeepSeek-R1、Claude Code/Cursor/Windsurf/Cline/Copilot/Devin、Bolt/v0/Lovable、Midjourney/DALL-E、Sora/Runway、Zapier/n8n；未知工具用 Universal Fingerprint 四问兜底
- Memory Block 系统：跨会话记忆保留
- 对灵感大王启示：目标工具 profile、token 审计、反模式检测三项均可借鉴，且灵感大王的问答库比其 ≤3 问更强

#### A4. 其他直接竞品（简评）
| 项目 | Stars | 形态 | 关键差异 |
|---|---|---|---|
| Pastry | 小 | macOS 菜单栏 Tauri | **全局热键 Cmd+Opt+V 拦截优化**；六轴框架 |
| Cue | 小 | Tauri 桌面 | 多 provider（含本地 CLI）；**长 prompt 复制为 PNG 省 token** |
| PromptVault Lite | 小 | Tauri | 本地优先 prompt 档案管理 + 质量检查，205 commits |
| ScholarPrompt | 小 | Web | 学术垂直场景（标准提示词架构） |
| PromptKitcha | 小 | Tauri | 一键优化，MIT |

### B. 相邻竞品（spec 驱动开发 / 需求澄清）

| 项目 | Stars | 机制 | 对本项目启示 |
|---|---|---|---|
| GitHub Spec Kit | ~69k | constitution→specify→clarify→plan→tasks→implement 六阶段，spec/plan/tasks 三层产物分离，人审卡点 | 输出可升级为 **spec/plan 分层产物**（不只一段 prompt） |
| BMAD Method v6 | ~35k | 虚拟敏捷团队 persona（PM/架构/QA） | persona 化问题库（已有前端/后端/PPT 场景雏形） |
| OpenSpec | 生产级 v1.3 | 存量项目变更管理 | 与项目扫描功能契合 |
| GPT-Engineer | 数万 | **需求细化阶段主动提问**（QA 式交互先驱）、identity 风格学习 | 验证「提问式澄清」路线价值 |
| SpecForge | 小 | 意图分解/约束提取/边界发现/**冲突检测**/spec 版本化；导出 JSON/YAML/MD | 冲突检测、多格式导出可借鉴 |
| Amazon Kiro | 商业 | EARS 需求格式，vibe↔spec 切换 | IDE 集成重方向，暂不跟 |

### C. MCP 生态（新兴分发渠道）
| 项目 | 活跃度 | 机制 |
|---|---|---|
| claude-prompts-mcp | 822 commits | prompt 工作流 MCP server：模板 + 质量门 + 可组合算子语法 + 导出为原生 skill |
| PromptCompanion | v1.0.0 | MCP stdio server + **Git 友好 JSONL 同步（冲突检测）** + 便携模式 + Windows 更新检查 |
| BeCrafter/prompt-manager | 250 commits | YAML 模板管理 + 语义搜索 + 工具沙箱 + MCP |

启示：**把灵感大王的问题库/生成能力包装成 MCP server**，是接入 Claude Code/Cursor 等客户端工作流的新分发渠道，且与「目标工具适配」天然协同。

### 定位结论
**灵感大王护城河**（竞品均无的组合）：① 完整问题库引导式澄清（Prompt Master 仅 ≤3 问、prompt-optimizer 零提问）② 本地规则引擎兜底免 key（80% 覆盖，全部竞品强依赖 LLM）③ 桌面常驻悬浮球 + 系统级权限 ④ 项目扫描/截图诊断/需求同步联动 ⑤ keyring 密钥安全。
**关键差距**（按证据强度排序）：① 无目标工具 profile（Prompt Master 30+ 工具已验证需求）② 无 token 审计/反模式检测 ③ 形态单一（prompt-optimizer 33.2k stars 证明 Web/插件多形态市场）④ RAG/偏好学习未接线（内部审查 C1/C2/C3）⑤ 无全局热键（Pastry 已验证）⑥ 无 MCP 分发渠道 ⑦ 文档上传解析（prompt-iterator 有）⑧ 未开源。

## What Changes
- **Phase 0 清债**：剔除调试上报（S1）、收窄 capability（S3）、处理死代码（C1/C3）、补文档、rAF 节流（P3）
- **Phase 1 目标工具适配**（借鉴 Prompt Master 已验证需求）：目标工具选择（Claude Code/Cursor/Copilot/Codex/通用），按工具定制 prompt 结构 + 轻量 token 审计
- **Phase 2 智能接线**：RAG 全局初始化（C2）、PreferenceLearner 接入（C1）、向量存储性能（P1/P2）
- **Phase 3 效率入口**：全局热键（借鉴 Pastry）、复制格式联动工具 profile、删除确认
- **Phase 4 MCP server**（新方向）：问题库/生成能力包装为 MCP server，接入 Claude Code/Cursor
- **Phase 5 发布就绪**：开源（README 双语含竞品对比）、CI 三平台、自动更新
- 文档上传解析（PDF/DOCX）与浏览器插件列为 Backlog（观察 Phase 1-4 反馈后决定）

## Impact
- Affected specs: unify-material-ui-polish（UI 规范延续）
- Affected code: src/engine/PromptGenerator.ts（工具 profile）、src/hooks/useVectorStore.ts、src/components/SettingsPanel.tsx、src/engine/PreferenceLearner.ts、src-tauri/tauri.conf.json、src-tauri/capabilities/default.json、新增 src-tauri MCP server 模块或独立 bin

## ADDED Requirements

### Requirement: 目标工具适配（Phase 1）
系统 SHALL 提供目标 AI 工具选择，并按所选工具输出定制化 prompt 结构。
#### Scenario: 选择 Claude Code 后生成
- **WHEN** 用户选择目标工具为 Claude Code 并完成问答
- **THEN** 生成的提示词使用 XML 标签结构（Claude 系最佳实践）；选 Cursor 则包含文件路径占位与任务分步 + stop 条件

### Requirement: token 审计提示（Phase 1 轻量版）
系统 SHALL 显示生成 prompt 的 token 估算，超阈值（2000）时给出精简建议。
#### Scenario: 超长提示
- **WHEN** 生成结果估算超过 2000 token
- **THEN** ResultPanel 显示警示并提供「精简模式重新生成」入口

### Requirement: RAG 全局初始化（Phase 2）
系统 SHALL 在应用启动时初始化向量索引（模型懒加载），使跨会话检索对所有用户生效。
#### Scenario: 普通用户 RAG 生效
- **WHEN** 用户从未打开设置面板且已有历史 QA
- **THEN** retrieveSimilar 返回非空

### Requirement: 偏好学习接入（Phase 2）
系统 SHALL 在 start() 后对 currentQuestion 匹配推荐答案并显示「历史推荐」角标。
#### Scenario: 老用户预填
- **WHEN** 历史偏好含「深色风格」且当前问题涉风格
- **THEN** 对应选项显示推荐标记

### Requirement: 全局热键（Phase 3）
系统 SHALL 注册全局热键，任意应用下唤起窗口并聚焦输入。
#### Scenario: 浏览器中触发
- **WHEN** 用户在浏览器按注册热键
- **THEN** 窗口置顶展开并聚焦输入区

### Requirement: MCP server（Phase 4）
系统 SHALL 提供 MCP server（stdio），暴露「引导式生成提示词」工具：客户端传入需求描述，返回结构化 prompt（支持工具 profile 参数）。
#### Scenario: Claude Code 调用
- **WHEN** Claude Code 连接本 MCP server 并调用 generate_prompt 工具
- **THEN** 返回按 target_tool 参数定制的结构化提示词，质量与桌面端一致（共享问题库与生成引擎）

### Requirement: 发布就绪（Phase 5）
系统 SHALL 具备开源条件：README（双语，含竞品对比表）、MIT LICENSE、CI 三平台构建、Tauri updater 自动更新。

## MODIFIED Requirements

### Requirement: 调试上报剔除（Phase 0）
debugReporter SHALL 仅开发模式生效；生产 CSP 移除 127.0.0.1:7777。

### Requirement: capability 收窄（Phase 0）
capabilities/default.json 移除 WebView 未用的 fs 插件权限。

### Requirement: 缩放节流（Phase 0）
useResize 用 rAF 合并 pointermove 更新。

## REMOVED Requirements

### Requirement: PreferenceLearner 死代码
**Reason**: 从未被主流程调用（审查 C1）。
**Migration**: Phase 2 接入；若砍 Phase 2 则删除文件与测试。
