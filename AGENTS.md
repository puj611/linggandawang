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
7. **Rust IPv6 内网判断必须先 `to_ipv4_mapped()` 还原**（2026-08-21 审查 P1）：`::ffff:127.0.0.1` 的 `is_loopback()` 返回 false（std 只认 `::1`），漏判即 SSRF 绕过；NAT64 `64:ff9b::/96` 同理需整体拒绝，见 llm_proxy.rs `is_private_ip`
8. **tauri-plugin-sql 的 execute 每条独立提交，无跨语句事务**（2026-08-21 审查 P2）：需要原子性时用 staging 表 + `DROP/RENAME`，不要 DELETE+INSERT 裸奔；本例见 vectorStore.ts `persistVectorStore`
9. **MCP stdio server 双红线**（2026-08-21 审查 P3）：stdout 只允许写协议消息（日志重定向 stderr），且必须限制单行长度防超大 payload OOM，见 mcp-server/index.ts
10. **Tauri updater pubkey 是「.pub 文件原始内容、原样使用」**（2026-10-24 P0 踩坑）：`tauri signer generate` 产出的 `.pub` 文件内容本身就是 minisign 公钥两行明文的 base64；`tauri-plugin-updater` 的 `verify_signature` 先 base64 解码配置值再交 `minisign PublicKey::decode` 解析两行明文。对 `.pub` 内容再做一次 base64（双重编码）会导致更新验签运行时失败。私钥文件内容同样原样配置到 `TAURI_SIGNING_PRIVATE_KEY`
11. **版本一致性守门**（2026-10-24 起）：package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml / CHANGELOG 首条条目四处版本号必须一致，`npm run check:version`（scripts/check-version.mjs）校验，不一致 exit 1；发版前必跑
12. **本机 WorkBuddy 沙箱下 vitest 默认多 worker 偶发 EPERM**（2026-10-24 实测）：TEMP 模块缓存并发写入被沙箱 broker 拦截，测试全过但退出码 1；用 `npx vitest run --pool=forks --poolOptions.forks.singleFork=true` 稳定通过；CI 干净环境不受影响，勿因此改 test 脚本
13. **tauri-action 默认执行 `npm run tauri build`，package.json 必须有 `tauri` 脚本**（2026-10-24 首次发布演练实测）：缺该脚本时三平台均在 `Build and upload release artifacts` 步骤报 `Missing script: tauri` 并 exit 1；本项目已补 `"tauri": "tauri"`。发布前可用 `npm run tauri -- --version` 自检
14. **GitHub 会剥离 release 资产名中的非 ASCII 字符，productName 必须全 ASCII**（2026-10-25 发布核对实测）：productName 为「灵感大王」时 CI 磁盘产物为 `灵感大王_0.9.0_x64-setup.exe`，GitHub 上传后资产名中文字符被剥成 `_0.9.0_x64-setup.exe`；且 tauri-action 拼 latest.json 时按本地原名在远端（已净化）资产列表中找签名，必然报 `Signature not found for the updater JSON. Skipping upload...`，latest.json 全平台缺失。解法：productName 用 ASCII（窗口标题等显示名在 config 其他字段独立控制）；另 macOS 打包必须含 updater-enabled target（`app`/`dmg` 中仅 `app` 生成 `.app.tar.gz` 更新器产物），见 release.yml matrix
