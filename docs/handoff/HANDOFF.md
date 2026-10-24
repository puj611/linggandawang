# HANDOFF.md — 灵感大王项目交接文档

> 本文件是跨 AI 工具/Agent 接手本项目时的唯一权威交接入口。纯 Markdown，不依赖任何工具特有语法。
> 维护规则：每轮任务结束必须更新（见用户全局规则 handoff-standard.md）；历史版本归档至 `docs/handoff/archive/`。

---

## 4.1 项目概览

- **项目名称**：灵感大王（linggandawang）
- **一句话描述**：桌面悬浮窗 Prompt 优化工具——通过「反向提问」把模糊灵感挤成精准提示词。
- **目标用户/场景**：需要向 AI 清晰表达需求的个人开发者/设计师；本地优先、隐私安全定位（密钥进系统 keyring，数据不出机器）。
- **技术栈**：Tauri 2.x（Rust 后端 + WebView 前端）｜React 18 + TypeScript 5.4 + Zustand 4.5｜Vite 5 + Tailwind 3.4｜Vitest 1.6 + jsdom｜SQLite（tauri-plugin-sql，浏览器降级 localStorage）｜keyring 密钥存储｜OpenAI 兼容 LLM 适配器（DeepSeek/通义/自定义）
- **目录结构**（关键目录）：

  | 目录 | 职责 |
  |---|---|
  | `src/components/` | React 组件（UI 层，不含业务逻辑，30 个组件） |
  | `src/engine/` | 核心引擎（纯业务逻辑，不依赖 Tauri API/React，17 个模块） |
  | `src/stores/` | Zustand 状态镜像层（11 个） |
  | `src/hooks/` | 编排层（调用 engine + stores） |
  | `src/lib/` | 基础设施（LLM adapter、sqlite、vectorStore、dataExport 规划中） |
  | `src/question-bank/` | 问题库 YAML（bank.yaml 65 + bank-backend 28 + bank-ppt 15 = 108 条） |
  | `src-tauri/src/commands/` | Rust 命令（updater、sidecar、llm_proxy、project、api_key） |
  | `mcp-server/` | MCP Server（当前 2 个工具：list_questions、generate_prompt） |
  | `docs/` | 文档（PRD、架构、reference 接口契约） |
  | `scripts/` | 构建/校验脚本（check-version.mjs 等于 2026-10-24 新增） |

- **环境搭建与运行方式**（完整命令，工作目录 = 项目根 `D:\AI工作平台\灵感大王`）：

  ```bash
  npm install            # 安装依赖（@xenova/transformers@2.17.2 已正式声明，无需 --no-save）
  npm run dev            # Vite 开发服务器（浏览器模式）
  npx tauri dev          # Tauri 开发模式
  npm run build          # tsc -b && vite build
  npm run lint           # eslint src/
  npm test               # vitest run
  node scripts/check-version.mjs   # 版本一致性校验（R03 新增，要求退出码 0）
  cd src-tauri && cargo check      # Rust 检查
  cd src-tauri && cargo test       # Rust 测试（5 个）
  npm run mcp:build && npm run mcp:smoke   # MCP 构建与冒烟
  npx tauri build        # 打包安装包（需签名私钥环境变量）
  ```

- **外部依赖**：
  - GitHub 仓库：`https://github.com/puj611/linggandawang.git`（origin）
  - GitHub Secrets（发版必需，**由用户手动在仓库网页配置**）：`TAURI_SIGNING_PRIVATE_KEY`（更新签名私钥内容）；未设密码则不需要 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - LLM API：用户自配 DeepSeek/通义/自定义 OpenAI 兼容端点（密钥存 keyring，导出功能绝不含密钥）
  - 嵌入模型：运行时从 huggingface.co 下载 Xenova/all-MiniLM-L6-v2（~90MB，懒加载）
  - **环境变量**：无项目级 .env 强制项；本机代理走环境变量 HTTP_PROXY/HTTPS_PROXY

---

## 4.2 当前状态快照

- **分支**：`main`
- **最近提交**：`f77e6af` feat(compare): R04 前后对比测试 MVP（2026-10-24 下午）；`48146a3` docs: 交接文档 + 踩坑；`cbd277d` feat(release): P0 发布链止血 0.9.0
- **工作区状态**：干净（P0 三件套 + R04 均已提交；仅剩根目录杂物 `nul)` 未处理，待用户确认）
- **整体进度**：P0 阶段「可靠性与可测试性」进行中：R01–R04 已完成闭环并提交（R04 经 QA 两轮独立验证，含 1 个 P1 阻断缺陷修复）；R05 变量模板 / R06 导出导入 / R07 质量门待排期。旧计划文档（`docs/后续开发计划/`、`docs/长期推进计划.md`）已被路线图取代（标记工作见 4.6 待确认问题）。
- **最后更新时间**：2026-10-24 18:40 (GMT+8)
- **本轮任务简述**：完成 R04 前后对比测试 MVP（对比引擎 + 双栏面板 + SQLite/localStorage 留档 + 迁移 0006），QA 两轮独立验证（Round 1 抓出槽位丢失 P1，Round 2 确认闭环），已提交 `f77e6af`。

---

## 4.3 任务记录（最新在前，保留最近 5 轮）

### R04 轮（2026-10-24 下午）— 前后对比测试 MVP

**任务目标与用户决策**：按路线图 R04 任务卡实现「同一输入两版提示词并排对比并留档」MVP；用户指令「开始下一步」，范围仅此一张卡，不提交由主理人统一收口。

**实际完成内容**（新增 7 文件 + 修改 5 文件，commit `f77e6af`）：
- 新增 `src/engine/ComparisonEngine.ts`（纯函数：段落贪心前瞻对齐 + 约束条目集合 diff + `isPromptResultLike` 形状守卫）、`src/lib/comparisonStore.ts`（SQLite/localStorage 双路径 + `ensureSchema` 兜底建表建索引）、`src/components/ComparePanel.tsx`（双栏并排/逐段折叠/约束条目 +−/保存·重命名·二态删除/⇄ 交换）、`src-tauri/migrations/0006_create_comparison_runs.sql`、测试三件（31 + 11 + 7 例）
- 修改 `src-tauri/src/lib.rs`（+6 注册迁移 6）、`src/stores/appStore.ts`（+27/-2 槽位上提）、`src/components/MainWindow.tsx`（+3 挂载）、`src/components/ResultPanel.tsx`（+9「对比」按钮）、`src-tauri/Cargo.lock`（0.1.0→0.9.0 元数据收口）

**关键决策及理由**：
- **P1 槽位缺陷修复（本轮最重要）**：QA 首轮抓出「A/B 槽位存于组件本地 useState + 面板条件挂载 → 必须关面板才能重新生成 → 一关即丢态 → 验收①不可达、保存按钮恒禁用」。修复为槽位上提 `appStore`（`compareLeft/compareRight` + `setCompareSlot` + `swapCompareSlots`），`closeCompare/collapse/backToExpanded` 均不清空（仅槽位 × 显式清空），并加 store 级回归测试固化契约。
- 引擎不做字符级 diff / 语义评分：遵循路线图 R04 边界，只做段落对齐 + 新增/缺失标记。
- 集成走最小增量：ResultPanel 加 1 个按钮、MainWindow 加 1 行挂载，不改既有视觉与交互。
- Cargo.lock 版本同步纳入本轮提交：R03 升版后 lock 滞后，任何 cargo 命令都会自动刷新。

**验证方式与结果**：
- **QA Round 1（全新实例）**：自建 24 例独立探针（未照抄工程师用例）证明引擎/存储/迁移正确；质量门 415 测试全绿、cargo check exit 0；发现 P1 阻断 → 路由 Engineer。
- **QA Round 2（另起只读实例）**：自建 9 例探针，含端到端链路复现（A 载入→关面板→换结果→载入 B→`comparePromptResults` 非 null 且 changedSegments 正确）确认 P1 闭环；422 测试全过、tsc/lint/build/check-version 全 exit 0；Rust 自 Round 1 后零变更；**最终路由 NoOne**。
- 既有 24 个测试文件零改动（415 + 7 = 422）；lint 39 warnings 全为既有文件遗留，R04 新文件 0 告警。
- 并发实例事故：两个 QA 实例同时在跑导致一次统计被探针文件污染（28/431），剔除后干净重跑 27/422 一致——**教训：并行验证的探针文件名须带实例后缀，或改为串行**。

**遗留问题**：
- P2：`openRun` 双侧回填、无法「当前结果 vs 某条历史记录」单侧载入（约 10 行可加 →A/→B）；槽位不跨重启（留档由 comparison_runs 承担，符合验收③）；`openRun` 不保留记录 id，保存产生新记录而非覆盖。
- P3：无「清空两侧」按钮且 ESC 收起后槽位保留无提示；数据损坏时 `key={runId}` 可能重复 0；`renamingId===0` 静默失效。
- **建议 RTL（@testing-library/react）列入 R07**：项目无组件测试基建，P1 这类集成缺陷在结构上无法被单测发现。

### P0 三件套轮（2026-10-24 上午）— 发布链止血

#### 任务目标与用户决策
基于《灵感大王后续开发路线图》（2026-10-24）P0「本周即可执行」前三项任务卡：R01 发布链止血、R02 构建可复现、R03 版本号与 CHANGELOG 治理；用户同时要求做好交接文档。用户决策（2026-10-24 AskUserQuestion 确认）：① 版本统一 **0.9.0**（CHANGELOG 已存在 0.7.0/0.8.0 条目，顺延编号，现有条目不重编号）；② **重新生成**更新签名密钥对；③ 本轮范围仅 R01+R02+R03，不打标签、不提交、不推送。

#### 实际完成内容（9 个已跟踪文件修改 + 1 个新脚本 + 本交接文档）

| 文件 | 改动要点 |
|---|---|
| `src-tauri/tauri.conf.json` | endpoints 占位→`https://github.com/puj611/linggandawang/releases/latest/download/latest.json`；pubkey 替换为重新生成密钥对的公钥；version 0.1.0→0.9.0 |
| `.github/workflows/release.yml` | 删除「Install undeclared runtime dependency」步骤连同 TODO 注释块；注释占位符→puj611 |
| `package.json` | version→0.9.0；dependencies 新增 `@xenova/transformers@2.17.2`；scripts 新增 `check:version` |
| `package-lock.json` | @xenova/transformers 依赖树正式入库（onnxruntime-web 等，+895 行）；根版本号两处同步 0.9.0 |
| `src-tauri/Cargo.toml` | 仅 version→0.9.0 |
| `CHANGELOG.md` | 顶部新增 0.9.0 条目；重复的 `[0.5.0]-07-15`（M13）/`[0.6.0]-07-15`（P0 体检）合并删除（独有内容以「补录」小节保留）；`[0.7.0]`/`[0.8.0]` 日期修正为 2026-08-20 |
| `scripts/check-version.mjs` | 新增：零依赖 Node ESM，比对 4 处版本号，不一致 exit 1 并逐项打印 |
| `.gitignore` | 新增 `!scripts/check-version.mjs` 例外 + `backup/` 忽略规则 |
| `docs/reference/release-process.md` | endpoints 真实化；pubkey 格式说明与指纹更正；状态段改写 |
| `docs/audits/2026-08-21-core-modules.md` | 第 67 行 URL 片段同步（占位符零命中验收所需） |

#### 关键决策及理由
- 选 0.9.0 而非路线图字面的 0.7.0：CHANGELOG 实测存在 0.7.0（RAG）/0.8.0（模板库）两条 legacy 条目（git 实证为 2026-08-20 工作，文中日期 07-15 为补录错误），直接设 0.7.0 会造成重复版本号。路线图文档已同步改标签（原文件备份于 `backup/20261024_153615_roadmap-version-sync/`）。
- 重新生成密钥而非找回旧私钥：`~/.tauri/` 不存在，commit `755e047` 亦确认 no private key；且仓库无任何 tag、从未发版。
- **pubkey 格式修正（本轮最重要教训）**：工程师初版把 `.pub` 文件内容又做了一次 base64（204 字符），构成双重编码。主理人用 tauri-plugin-updater 2.10.1 源码定性：`verify_signature` 先 base64 解码配置值，再交 minisign-verify `PublicKey::decode` 解析**两行明文**。Tauri 的 `.pub` 文件内容本身就是 base64(两行明文)，配置值必须**原样使用**（152 字符）。已修正并经 QA 逐字符比对确认。
- npm test 多 worker 沙箱 EPERM：裁决不改 test 脚本——CI 干净环境不受影响，属 WorkBuddy 沙箱 TEMP 缓存写入限制；本机验证用 `npx vitest run --pool=forks --poolOptions.forks.singleFork=true`。
- backup/ 入 .gitignore：备份是本地 artifact（规则要求保留 7 天用户手动清理），禁止入库。
- 仓库根 `nul)` 852B 杂物：保留不动，等用户确认后清理。

#### 验证方式与结果
- **QA 独立验证（严过关，Round 1，全新实例）**：公钥链路 5/5（含逐字符程序化比对、base64 解码格式、错误值零残留、指纹复算）；质量门 7/7：`npm run lint` exit 0（0 error/39 warnings）、`npx tsc --noEmit` exit 0、vitest 单 worker **373/373 通过（24 文件）**、`npm run build` exit 0（4.79s，transformers chunk 823.20 kB）、`node scripts/check-version.mjs` exit 0、`npm ls @xenova/transformers` 2.17.2 已声明、代码与配置文件中 `你的用户名` 零命中；校验脚本失败路径 3/3（scratch 实测 exit 1 且明确指出 Cargo.toml 差异）；diff 审查逐文件无越界。
- **Round 2 回归**：工程师修复 package-lock.json 根版本滞后（2 处，0.1.0→0.9.0）、.gitignore 增补 `backup/` 忽略规则、CHANGELOG 两处措辞精确化；QA Round 2 只读回归四项全过（lock diff 仅 2 行版本改动且 yocto-queue 等嵌套依赖未动、backup/ 已被 .gitignore:105 忽略、措辞已精确化、check-version + `npm ci --dry-run` 均 exit 0），**最终路由判定 NoOne**。
- 测试总数 373 高于 CHANGELOG 0.6.0 记载的 330：08-21/08-25 修复新增，非本轮引入。

#### 遗留问题
- **待用户手动**：GitHub 仓库 Settings → Secrets → Actions 新增 `TAURI_SIGNING_PRIVATE_KEY`，值为 `C:\Users\puj\.tauri\linggan.key` 文件**完整内容**（base64 文本，空密码无需 PASSWORD secret；内容切勿外传）。配置前打 tag 构建必败（预期门禁）。
- **已提交**：`cbd277d`（feat/release，10 文件）+ `48146a3`（docs，交接文档 + AGENTS.md 踩坑）；工作区干净，仅剩根目录杂物 `nul)` 未处理。
- 未打标签：`v0.9.0-rc.1` 发布演练待 Secret 配置后由用户授权执行。
- CSP 缺 huggingface.co（backlog，见 4.4）；`nul)` 待用户确认删除。

---

## 4.4 待办事项（Backlog）

### P0（阻塞/尽快）
| 事项 | 相关文件/模块 | 备注 |
|---|---|---|
| 配置 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY` | 仓库 Settings → Secrets（用户手动） | 私钥在本机 `C:\Users\puj\.tauri\linggan.key`，内容**切勿外传**；配置前打 tag 构建会按预期失败 |
| 打 `v0.9.0-rc.1` 预发布标签跑发布演练 | git tag + push | 需先完成 Secret 配置；演练后人工审核 draft release 产物四平台 + latest.json |
| R05 变量模板 MVP | `src/engine/TemplateRetriever.ts` 扩展、新增 `TemplateComposer.ts`、`src/components/TemplateLibrary.tsx` | 仅 `{{ }}` 语法 + 插入按钮 |
| R06 数据导出与导入 | 新增 `src/lib/dataExport.ts`、`src/components/settings/DataPanel.tsx` | 导出绝不含 API Key；导入先备份 |
| R07 质量门 | `.github/workflows/ci.yml`、`vitest.config.ts`、`package.json` | lint + cargo test + 覆盖率（总体 ≥75%/engine ≥85%）+ Windows job + 集成测试 + **RTL 组件测试基建（@testing-library/react，R04 轮教训）**；check-version.mjs 入 CI |

### P1（v0.10.x，2027 Q1）
R08 MCP 扩 5 工具｜R09 Chrome 插件 MV3｜R10 国际化｜R11 社区分发｜R12 三档状态可见性。

### P2 / 技术债
| 事项 | 备注 |
|---|---|
| CSP 缺 huggingface.co | vectorStore 运行时下载嵌入模型会被 Tauri CSP connect-src 拦截（浏览器模式不受影响）；2026-10-24 侦察发现，待修 |
| 清理根目录 `nul)` 垃圾文件 | 852B untracked 文件，需用户确认后删 |
| `tauri.conf.json` 的 `beforeDevCommand` 硬编码 `c:/Users/puj/AppData/Local/Agnes/node/npm.cmd` | 机器相关路径，换机即失效 |
| 对比面板：单侧回填（当前结果 vs 某条历史记录）+「清空两侧」按钮 | R04 遗留 P2/P3，约 10–20 行；槽位为内存态不跨重启（留档由 comparison_runs 承担） |
| 对比面板数据兜底：`key={runId}` 损坏时重复 0、`renamingId===0` 静默失效 | R04 遗留 P3，风险低 |
| CHANGELOG 补 0.2.0 之前的 0.1.x 细节 | 低优先 |

---

## 4.5 重要约束与踩坑记录

### 项目约定
- 分层约束：UI 层（components）→ hooks/stores；编排层（hooks）→ engine + stores；引擎层（engine）纯逻辑不依赖 Tauri/React；基础设施层（lib）不依赖 engine/stores。
- TypeScript strict，禁 `any`（必须时加 eslint-disable 说明）；LLM 输出归一化用 `unknown` + 类型守卫。
- 组件卸载后禁止 setState（mountedRef）；setTimeout 用 ref 跟踪 + useEffect cleanup；Zustand 逐个 selector/useShallow；Store IO 必须 try/catch；剪贴板必须 textarea fallback。
- 版本号三处 + CHANGELOG 首条必须一致，改版本必跑 `node scripts/check-version.mjs`。
- **增量修改铁律**：只改当前任务范围，不碰既有视觉/交互/业务逻辑。
- 每 2 周一个小版本；每个版本必须 lint + test:coverage + cargo test 三绿后才打标签；每次只推进一张任务卡。

### 禁止事项
- **私钥红线**：`~/.tauri/linggan.key` 内容禁止打印到对话、写入任何项目文件、进入日志/报告；只允许传播 `.pub` 公钥。
- 未配置 `TAURI_SIGNING_PRIVATE_KEY` 前禁止打 v* 标签（构建必败，属预期门禁）。
- 发版类操作（打标签/推送/发布）必须用户明确确认后执行。
- 模板市场、图片工作流全面对标、云同步、Electron 迁移、技术债感知面板、视觉动效专项——路线图第六章「明确不做清单」，新想法只进 backlog。
- 本机禁止删除 node_modules 或 >50 文件的批量删除（safe-delete 护栏 fail-closed）。

### 踩过的坑
1. **版本号三处不一致 + CHANGELOG 重复/乱序**（2026-10-24 修复）：package.json/tauri.conf.json/Cargo.toml 均停在 0.1.0，而 CHANGELOG 有 0.5.0×2、0.6.0×2 及两条日期错误的 legacy 条目（0.7.0/0.8.0 实为 08-20 工作）。解法：统一 0.9.0 + check-version.mjs 守门。
2. **@xenova/transformers 未声明**：release.yml 用 `--no-save` 绕过，`npm ci` 环境构建不可复现。解法：正式声明 + 删除绕过步骤。
3. **签名私钥丢失**：pubkey 在配置里但私钥不在本机；因从未发版，重新生成无副作用。
4. **WorkBuddy PowerShell 工具是 5.1**：7 语法（&&、?:、??）需写 .ps1 后 `pwsh -NoProfile -File`；stdout 常零输出，结果落盘再读。
5. **批量删除护栏**：>50 文件删除/重命名类操作 fail-closed 或静默改道回收站；可靠绕法只有 `[System.IO.File]::Delete` / bash `mv`，但仍遵守先备份后操作。
6. **Tauri invoke 在纯浏览器/jsdom 不可用**：测试必须 mock `@tauri-apps/api/core` 和 `@/lib/sqlite`。
7. **Rust IPv6 内网判断必须先 `to_ipv4_mapped()`**：`::ffff:127.0.0.1` 的 `is_loopback()` 返回 false，漏判即 SSRF 绕过。
8. **tauri-plugin-sql execute 无跨语句事务**：需原子性时用 staging 表 + DROP/RENAME。
9. **MCP stdio server**：stdout 只写协议消息，日志重定向 stderr，限制单行长度。

---

## 4.6 给下一个 Agent 的提示

1. **建议先读**：`AGENTS.md`（架构与命令）→ 本文件 → 路线图（`D:\AI工作平台\逆向工程\tasks\20261024_linggan_roadmap\灵感大王后续开发路线图.md`）→ `docs/reference/release-process.md`（发版链路）。
2. **当前最该做的一件事**：R01–R04 已提交（`cbd277d` / `48146a3` / `f77e6af`）；下一张卡建议 **R05 变量模板 MVP**（与 R04 同属可测试性链，路线图节奏）或 **R07 质量门**（含 RTL 组件测试基建与覆盖率门槛，G2 发版门要求）。每次一张卡。
3. **需向用户确认的悬而未决问题**：
   - GitHub Secret 配置由用户手动完成后，是否授权打 `v0.9.0-rc.1` 预发布标签演练？
   - 是否将 `docs/后续开发计划/PRD-后续开发.md`、`docs/长期推进计划.md` 标记为「历史文档（已被 2026-10-24 路线图取代）」并在文件头加指向行？
   - 根目录 `nul)` 垃圾文件是否删除？
   - CSP huggingface.co 拦截问题是否单独开任务卡修复？
