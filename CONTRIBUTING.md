# 贡献指南

## 开发环境

- **Node.js ≥ 20** 与 **npm**（仓库带 `package-lock.json`，请统一使用 npm，勿混用 pnpm/yarn 生成其他 lockfile）
- **Rust stable**（rustup 安装，Tauri 2 后端编译需要）
- Linux 还需安装 Tauri 系统依赖（`libwebkit2gtk-4.1-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev` 等，见 [Tauri 官方文档](https://tauri.app/start/prerequisites/)）；Windows / macOS 无需额外依赖

## 本地启动

```bash
npm install        # 安装前端依赖
npx tauri dev      # 开发模式（自动拉起 Vite 与桌面窗口）
```

## 提交前检查（PR 必须全部通过）

```bash
npm run lint                # ESLint
npx tsc --noEmit            # TypeScript 类型检查
npm test                    # vitest 单测
cd src-tauri && cargo check # Rust 编译检查
```

改动 `mcp-server/` 或 `src/engine/` 时额外执行：

```bash
npm run typecheck:mcp   # MCP server 类型检查
npm run mcp:build       # 重新构建 dist（客户端使用的才是新产物）
npm run mcp:smoke       # stdio 冒烟测试
```

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：`type(scope): 描述`，type 取 `feat / fix / docs / refactor / test / chore`，例如 `feat(engine): 风格问题新增多选项`。

## 架构约束

- 分层方向：`components` → `hooks` → `engine` / `lib`；engine 层为纯业务逻辑，不依赖 Tauri API 与 React，可独立测试
- 新增共享类型放 `src/engine/types.ts` 或 `src/types/`
- 测试随代码提交：engine / lib / stores 的新逻辑需附带 vitest 用例（Tauri API 一律 mock，参考现有 `__tests__/`）
- 完整分层说明、编码规范与已知坑点见 [AGENTS.md](./AGENTS.md)；已登记的架构偏差与例外约定见 `.trae/rules/architecture-deviations.md`

## 路线图

后续方向（目标工具 token 审计、反模式检测、文档解析等）见 `.trae/specs/competitor-research-and-roadmap/spec.md`，欢迎在 Issue 中认领讨论。
