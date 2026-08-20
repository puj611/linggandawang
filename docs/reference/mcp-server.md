# MCP Server 接口文档（linggandawang-mcp）

> Phase 4 Task 15/16：把「问题库引导式提示词生成」能力包装为 MCP stdio server，
> 供 Claude Code / Cursor 等 AI 编码工具直接调用。**免 API key、纯本地规则引擎、无网络调用。**

## 1. 架构概览

```
mcp-server/
├── index.ts          # stdio 入口：newline-delimited JSON-RPC 2.0，stdout 仅协议、日志走 stderr
├── protocol.ts       # 协议层：initialize / ping / tools/list / tools/call，通知静默丢弃
├── tools.ts          # 工具层：list_questions / generate_prompt，复用 src/engine 纯逻辑
├── vite.config.ts    # lib 预构建配置（解决引擎侧 *.yaml?raw 与 @ 别名）
├── tsconfig.json     # 独立类型检查（继承根配置，types 含 vite/client + node）
├── smoke-test.mjs    # 真子进程 stdio 冒烟测试
└── dist/             # vite build 产物（node 直接运行）
    └── index.js
```

### 为什么是「手写 JSON-RPC」而不是 @modelcontextprotocol/sdk

本机（Windows）只有 `C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe`（v20.18.0）
一个 node 可执行文件，**npm/pnpm/yarn 均不可用**，无法安装 SDK（其依赖树含 express/zod 等）。
MCP stdio 本质是 newline-delimited JSON-RPC 2.0，最小实现 initialize / tools/list / tools/call
四个方法即可与 Claude Code / Cursor 互通，因此手写协议层（`mcp-server/protocol.ts`，约 150 行），
零新增依赖。

### 为什么需要 vite 预构建

引擎侧 `QuestionLoader` / `AdjectiveClusterLoader` 使用 Vite 专属的 `*.yaml?raw` 导入与 `@/` 别名，
裸 node / tsx 无法解析。`mcp-server/vite.config.ts` 以 lib 模式把 `mcp-server/index.ts`
连同 import 的 `src/engine` 引擎链打包为 `mcp-server/dist/index.js`（node 内置模块与
package.json dependencies 保持 external，运行时从 node_modules 解析）。

### 引擎复用与依赖隔离

- 复用纯逻辑部分：`QuestionEngine`（状态机）→ `seedRouter`（免 key 规则路由）→ `PromptGenerator`（四段结构拼装）
- **不触发** LLM 意图分析（`llmAnalysis` 恒为 null），不读 Tauri 桌面环境，无网络调用
- 引擎 import 链中被拉入的 zustand store / @tauri-apps/api 仅为模块可达性存在，运行时不执行

## 2. 工具列表

### 2.1 `list_questions` —— 预览将被提问的问题

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `seed` | string | 是 | 需求描述/灵感种子，如「给登录页加表单校验」 |
| `scene` | string | 否 | `auto`（默认，关键词自动检测）/ `frontend-ui` / `backend-api` / `ppt` |

返回（`structuredContent`，同时以 JSON 字符串形式放在 `content[0].text`）：

```jsonc
{
  "scene": "frontend-ui",          // 路由后的场景
  "route_source": "fallback",      // keyword | cluster | fallback
  "matched_keywords": [],
  "total": 48,
  "questions": [
    {
      "id": "p-001",               // 问题 id（answers 参数的键）
      "stage": "perceive",         // perceive | name | spec | execute | verify
      "type": "single-choice",     // single-choice | multi-choice | open | scale
      "text": "你想修的是哪类东西？",
      "allow_custom": true,
      "options": [
        { "value": "ui-component", "label": "UI 组件（按钮/卡片/输入框）" }
        // ...
      ],
      "why": "为什么问这个（可选）"
    }
  ]
}
```

> 问题列表是「默认推荐选项策略」下的推进预览（jump 跳转会影响后续题目），与 `generate_prompt`
> 不传 answers 时的实际路径一致。

### 2.2 `generate_prompt` —— 一次性生成提示词

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `seed` | string | 是 | 需求描述/灵感种子 |
| `target_tool` | string | 否 | `generic`（默认）/ `claude-code` / `cursor` / `copilot` / `codex`，决定提示词结构适配 |
| `scene` | string | 否 | 同上，默认 `auto` |
| `answers` | object | 否 | `{ 问题id: 答案 }`；值为选项 `value` 或自由文本；multi-choice 可逗号分隔多选 |

行为：

1. `QuestionEngine.start(seed)` 规则路由选首题（无 LLM）
2. 逐题推进到完成：**传了 answers 的题用调用方答案**；未传的选择题用**每题默认推荐选项（第一选项）**；未传的开放题跳过
3. `PromptGenerator.generate()` 输出四段结构（动作/规格/约束/验证）markdown

返回：`content[0].text` 为完整 markdown；`structuredContent` 含 `markdown` / `scene` / `target_tool` / `route_source`。

错误约定：

- 参数错误（seed 为空、枚举非法）→ 工具级错误 `isError: true`，`content[0].text` 为中文原因
- 未知工具名 → JSON-RPC error `-32602`（与官方 SDK 行为一致）

## 3. 客户端配置

### Claude Code

```bash
# 方式一：官方 CLI（注意本机 node 不在 PATH，需写绝对路径）
claude mcp add linggan -- "C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe" "D:\path\to\灵感大王\mcp-server\dist\index.js"

# 方式二：编辑 ~/.claude.json（projects 节点）或项目 .mcp.json
```

项目级 `.mcp.json`：

```json
{
  "mcpServers": {
    "linggan": {
      "command": "C:\\Program Files\\Adobe\\Adobe Creative Cloud Experience\\libs\\node.exe",
      "args": ["D:\\AI工作平台\\灵感大王\\mcp-server\\dist\\index.js"]
    }
  }
}
```

### Cursor

编辑 `~/.cursor/mcp.json`（全局）或项目 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "linggan": {
      "command": "C:\\Program Files\\Adobe\\Adobe Creative Cloud Experience\\libs\\node.exe",
      "args": ["D:\\AI工作平台\\灵感大王\\mcp-server\\dist\\index.js"]
    }
  }
}
```

> 前置条件：先执行一次构建（见下节）。产物路径建议用绝对路径；node 不在 PATH 的机器必须写 node.exe 绝对路径。

## 4. 构建 / 运行 / 测试

```bash
# 本机（node 不在 PATH，用完整路径）
& "C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe" node_modules/vite/bin/vite.js build --config mcp-server/vite.config.ts

# 有 npm 的环境
npm run mcp:build      # vite build（产物 mcp-server/dist/index.js）
npm run mcp            # 直接启动 stdio server（调试用）
npm run mcp:smoke      # 真子进程 stdio 冒烟（initialize → tools/list → tools/call）
npm run typecheck:mcp  # tsc -p mcp-server --noEmit

# 单测（走 vitest，不走子进程）
npm run test -- src/mcp-server.test.ts
```

scripts 对照：

| script | 命令 |
|---|---|
| `mcp:build` | `vite build --config mcp-server/vite.config.ts` |
| `mcp` | `node mcp-server/dist/index.js` |
| `mcp:smoke` | `node mcp-server/smoke-test.mjs` |
| `typecheck:mcp` | `tsc -p mcp-server --noEmit` |

## 5. 协议实现要点（维护注意）

- **stdio 消息格式**：每行一条 JSON（newline-delimited），stdout 仅供协议；
  `index.ts` 把 `console.log` 重定向到 stderr，否则一行引擎日志就会让客户端 JSON 解析失败
- **协议版本**：initialize 回显客户端请求的 `protocolVersion`（未传时回退 `2024-11-05`），兼容主流客户端
- **通知**：`notifications/*` 一律静默丢弃（无 id 无响应）
- **推进安全阀**：jump 规则若成环，`MAX_STEPS=200` 防死循环（`tools.ts`）
- **修改引擎/mcp-server 源码后**：必须重跑 `mcp:build`，客户端用的才是新产物

## 6. 已知边界

- `generate_prompt` 不逐题交互：未传 answers 的题一律默认第一选项（含 jump 跳转路径），
  「不确定」语义的题在部分问题库中以第一选项形式存在
- MCP 场景不注入项目指纹（`project`/`scanResult` 为空），提示词中不含「## 0. 项目上下文」段
- 用户覆盖问题库（Tauri 侧 `bank.yaml` 覆盖机制）在 MCP 场景不生效，始终使用内置三场景问题库
