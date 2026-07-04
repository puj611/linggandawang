# AGENTS.md - 灵感大王项目工程指南

> 本文件是 AI Agent 和开发者进入项目时的首要参考，沉淀稳定信息（架构、边界、命令、约束）。

## 技术栈

- **桌面框架**: Tauri 2.x（Rust 后端 + WebView 前端）
- **前端**: React 18 + TypeScript 5.4 + Zustand 4.5（状态管理）
- **构建**: Vite 5 + tailwindcss 3.4
- **测试**: Vitest 1.6 + jsdom
- **数据库**: SQLite（tauri-plugin-sql），浏览器降级 localStorage
- **密钥存储**: keyring（Windows Credential Manager）
- **LLM**: OpenAI 兼容适配器（支持 DeepSeek/通义/自定义）

## 目录结构与模块边界

```
灵感大王/
├── src/
│   ├── components/       # React 组件（UI 层，不含业务逻辑）
│   ├── engine/           # 核心引擎（业务逻辑层，不依赖 Tauri API）
│   │   ├── QuestionEngine.ts      # 提问状态机
│   │   ├── PromptGenerator.ts     # 提示词生成
│   │   ├── LLMIntentAnalyzer.ts   # LLM 意图分析
│   │   ├── SmartFollowup.ts       # 动态追问
│   │   ├── ImagePromptExtractor.ts # 图片提示词拆解
│   │   ├── ScreenshotDiagnoser.ts # 截图诊断
│   │   ├── QuestionLoader.ts      # 问题库加载
│   │   ├── Selector.ts            # 动态选题
│   │   └── seedRouter.ts          # 种子路由
│   ├── stores/           # Zustand stores（状态镜像层）
│   ├── hooks/            # React hooks（编排层，调用 engine + stores）
│   ├── lib/              # 基础设施（LLM adapter、sqlite、env）
│   ├── types/            # TypeScript 类型定义
│   └── test/             # 测试设置
├── src-tauri/
│   ├── src/lib.rs        # Tauri 命令（后端）
│   ├── capabilities/     # 权限配置（最小权限原则）
│   └── tauri.conf.json   # Tauri 配置
├── docs/                 # 文档（PRD、架构设计、开发计划书）
├── .learnings/           # 踩坑记录
└── deliverables/         # 参赛交付物
```

### 分层约束

- **UI 层**（components）→ 可调用 hooks/stores，**不直接调用 engine/lib**
- **编排层**（hooks）→ 调用 engine + stores，是业务逻辑的入口
- **引擎层**（engine）→ 纯业务逻辑，**不依赖 Tauri API / React**，可独立测试
- **基础设施层**（lib）→ LLM adapter、SQLite 封装，**不依赖 engine/stores**
- **后端层**（src-tauri）→ Rust 命令，通过 invoke 暴露给前端

## 常用命令

```bash
# 开发
npm run dev              # 启动 Vite 开发服务器
npm run build            # tsc -b && vite build（构建前端）
npm run test             # vitest run（单次运行测试）
npm run test:watch       # vitest（监听模式）
npm run lint             # eslint
npx tsc --noEmit         # 类型检查（不产出）
npx tauri dev            # 启动 Tauri 开发模式
npx tauri build          # 打包 .msi/.exe

# Rust 后端检查
cd src-tauri && cargo check
```

## 编码规范

- TypeScript strict 模式，禁止 `any`（如必须用需加 `eslint-disable` 注释说明原因）
- LLM 输出归一化函数参数用 `unknown` + 类型守卫，不用 `any`
- 组件卸载后禁止 setState：async 操作 await 后检查 `mountedRef.current`
- setTimeout 必须用 ref 跟踪 + useEffect cleanup 清理
- Zustand 订阅用逐个 selector 或 `useShallow`，禁止整 store 订阅
- Store 的 IO 操作必须 try/catch + console.warn，不允许 unhandled rejection
- 剪贴板操作必须有 textarea fallback（非安全上下文 clipboard API 会抛错）

## 已知坑点

1. **Tauri invoke 在非 Tauri 环境（纯浏览器/jsdom）不可用**：测试时必须 mock `@tauri-apps/api/core` 和 `@/lib/sqlite`
2. **tauri-plugin-sql 的导出在不同版本有差异**：sqlite.ts 用 `as any` + eslint-disable 兼容，勿轻易改动
3. **Zustand useShallow 选 actions 对象**：actions 引用稳定不会触发重渲染，但选 state 字段需要逐个 selector
4. **AbortController 外部 signal 联动**：LLMAdapter 的 chat/chatStream/testConnection 通过 `addEventListener('abort', ...)` 联动内部 controller
5. **CSP connect-src `https:`**：为支持自定义 LLM baseUrl 保留，SSRF 防护由 validateBaseUrl 负责
6. **fs:allow-remove 已移除**：前端不直接使用 fs remove，如需要删除文件通过 Tauri 命令
