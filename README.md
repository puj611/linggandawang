# 灵感大王

> 把模糊想法问成精准提示词——本地优先的 AI 提示词生成器

[English](./README_EN.md) · 中文

一个常驻桌面的悬浮球工具：它**不润色你写的提示词**，而是通过**反向提问**把脑子里的模糊想法一步步「挤」成 AI 能精准执行的结构化提示词。本地优先——不配置任何 API key 也能完整使用。

## 它解决什么问题

用 AI 编码工具（Claude Code、Cursor、Copilot 等）时的常见困境：有想法但说不清、AI 润色反而失真、agent 改不对或没改。「灵感大王」的思路与传统润色工具相反：

| 传统润色工具 | 灵感大王 |
|---|---|
| 你写一段，AI 改一段 | AI 先问你，你再答 |
| AI 用统计默认值补全你没说的 | AI 暴露你没说的，让你说清楚 |
| 产物：AI 的平均值 | 产物：你的真实意图，被结构化 |
| 一次性大动作 | 多轮小步对齐 |

## 核心特性

- **引导式问答澄清**：三场景问题库（前端 UI / 后端 API / PPT）+ 提问状态机，按你的需求路由选题、逐轮追问，直到意图完整
- **本地规则引擎，免 key 可用**：关键词路由 + 形容词聚类兜底，零配置即可生成；接入 LLM（DeepSeek / 通义 / OpenAI 兼容 / 本地 Ollama）后获得意图分析与动态追问增强
- **目标工具适配**：针对 Claude Code / Cursor / Copilot / Codex 及通用场景输出不同结构的提示词（XML 标签、文件路径占位、任务分步与 stop 条件等）
- **截图诊断**：粘贴 UI 截图，自动拆解画面要素并定位「感觉不对」的具体问题
- **项目扫描联动**：扫描本地项目目录生成项目指纹，生成的提示词自动带上技术栈与目录上下文
- **RAG 历史增强**：历史问答向量化存储（本地嵌入模型 all-MiniLM-L6-v2），提问时检索相似历史增强上下文
- **偏好学习**：从历史答案学习你的选择倾向，常见问题显示「历史推荐」角标
- **MCP server**：内置 stdio MCP server，Claude Code / Cursor 可直接调用「引导式生成提示词」能力
- **全局热键 + 悬浮球常驻**：任意应用中一键唤起，收起为悬浮球不占桌面
- **keyring 密钥安全**：API key 存入系统凭据管理器（Windows Credential Manager 等），不落盘、不进代码

## 与同类项目对比

| | prompt-optimizer | Prompt Master | prompt-iterator | 灵感大王 |
|---|---|---|---|---|
| Stars | 33.2k | ~10k | — | — |
| 形态 | Web / 桌面 / 浏览器插件 / Docker | Claude skill | Web 应用 | 桌面（Tauri） |
| 提问式澄清 | ❌ 一键改写，不提问 | ⚠️ 最多 3 问 | ✅ 多轮表单引导 | ✅ 完整问题库多轮问答 |
| 免 key 可用 | ❌ 强依赖 LLM | ✅ | ❌ 强依赖 LLM | ✅ 本地规则引擎兜底 |
| 桌面常驻 | ⚠️ 有桌面端，非常驻 | ❌ IDE 内 | ❌ | ✅ 悬浮球 + 全局热键 |
| 目标工具适配 | ⚠️ 自定义模板 | ✅ 30+ 工具 profile | ❌ | ✅ Claude Code / Cursor / Copilot / Codex / 通用 |
| MCP server | ❌ | ❌ | ❌ | ✅ stdio |
| 本地数据 | ✅ 本地加密存储 | ✅ | ⚠️ 服务端处理 | ✅ SQLite + keyring |

> 数据为 2026-08 公开调研快照，以各项目仓库为准。对比仅覆盖本项目相关维度：prompt-optimizer 的前后对比测试与模板市场、Prompt Master 的 token 审计与 35 类反模式检测、prompt-iterator 的 PDF/DOCX 文档解析，都是本项目尚未具备或值得借鉴的能力。

## 安装

### 从 Release 下载

到 [Releases](../../releases) 页下载对应平台安装包：

| 平台 | 文件 |
|---|---|
| Windows | `.exe`（NSIS 安装包） |
| macOS（Apple Silicon / Intel） | `.dmg` |
| Linux | `.deb` / `.AppImage` |

### 从源码构建

环境要求：Node.js ≥ 20、Rust stable、npm（仓库带 `package-lock.json`，统一用 npm）。

```bash
git clone <仓库地址>
cd 灵感大王
npm install          # 安装前端依赖
npx tauri dev        # 开发模式运行（自动拉起 Vite 与桌面窗口）
npm run build        # 构建前端产物到 dist/
npx tauri build      # 打包安装包，产物在 src-tauri/target/release/bundle/
```

> `tauri.conf.json` 未配置 `beforeBuildCommand`，打包前需显式执行 `npm run build`。

## MCP Server

内置 stdio MCP server，把「引导式生成提示词」暴露为工具供 Claude Code / Cursor 调用——免 API key、纯本地规则引擎、无网络调用。

```bash
npm run mcp:build    # 构建 mcp-server/dist/index.js
```

Claude Code（项目 `.mcp.json`）或 Cursor（`~/.cursor/mcp.json`）配置：

```json
{ "mcpServers": { "linggan": { "command": "node", "args": ["/绝对路径/灵感大王/mcp-server/dist/index.js"] } } }
```

提供两个工具：`list_questions`（预览将被提问的问题）、`generate_prompt`（传入需求描述，可选目标工具与预设答案，返回结构化提示词）。完整参数、错误约定与协议细节见 [docs/reference/mcp-server.md](./docs/reference/mcp-server.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript 5 + Vite 5 + Tailwind CSS 3 |
| 状态 | Zustand 4 |
| 桌面 | Tauri 2（Rust 后端） |
| 存储 | SQLite（tauri-plugin-sql，含迁移脚本）+ keyring（系统凭据管理器） |
| 嵌入 | @xenova/transformers（all-MiniLM-L6-v2，本地推理，懒加载） |
| LLM（可选） | OpenAI 兼容适配器（DeepSeek / 通义 / OpenAI / 本地 Ollama） |
| MCP | 手写 JSON-RPC 2.0 stdio server，零额外依赖 |

## 目录结构

```
├── src/
│   ├── engine/          # 核心引擎：提问状态机、提示词生成、意图分析、偏好学习（纯逻辑，可独立测试）
│   ├── hooks/           # React hooks 编排层（UI 与引擎之间）
│   ├── stores/          # Zustand 状态层
│   ├── lib/             # 基础设施：LLM 适配器、SQLite、向量存储
│   ├── components/      # UI 组件
│   └── question-bank/   # 三场景问题库（YAML）
├── src-tauri/           # Rust 命令层：密钥代理、项目扫描、窗口管理、SQLite 迁移
├── mcp-server/          # MCP stdio server（复用 src/engine 纯逻辑）
├── docs/reference/      # 接口文档：MCP server、LLM 适配器、Tauri 命令
└── .github/workflows/   # CI 与 Release
```

## 开发

```bash
npm run dev                        # Vite 开发服务器
npx tauri dev                      # Tauri 开发模式
npm test                           # vitest 单测
npm run lint                       # ESLint
npx tsc --noEmit                   # TypeScript 类型检查
cd src-tauri && cargo check        # Rust 编译检查
npm run mcp:smoke                  # MCP stdio 冒烟测试
```

架构分层约束、编码规范与已知坑点见 [AGENTS.md](./AGENTS.md)；贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[MIT](./LICENSE)
