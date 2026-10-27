# HANDOFF 归档 — R07 质量门轮 + CSP 修复轮（2026-10-25）

> 从主文档 4.3 节迁出（主文档保留最近 5 轮）。归档文件生成后不再修改。
> 迁出时间：2026-10-27 ｜ 原因：4.3 已有 7 轮，超出「保留最近 5 轮」约定。

## 已迁出轮次

1. R07 质量门轮（2026-10-25 晚）— RTL 基建 + 覆盖率门槛 + CI 增强
2. CSP 修复轮（2026-10-25 傍晚）— RAG 嵌入模型下载放行

---

## 原文
### R07 质量门轮（2026-10-25 晚）— RTL 基建 + 覆盖率门槛 + CI 增强

**任务目标与用户决策**：执行路线图 R07（用户「继续推进计划」指令）。范围：RTL 组件测试基建、覆盖率门槛、CI 加 Windows job / cargo test / lint / check-version。

**实际完成内容**（+41 例测试，总数 422 → 463）：
- **RTL 基建**：devDeps 新增 @testing-library/react@16 / jest-dom@6 / user-event@14 / @vitest/coverage-v8@1.6.0；setup.ts 接入 jest-dom；首批组件测试 `src/components/__tests__/ui.test.tsx`（EmptyState/Spinner/ErrorBanner/StartTemplates，13 例，含关闭重置、role 可访问性、seed 映射）
- **engine 补测到 85%+**：摸底发现 `ScreenshotDiagnoser`（279 行）/`ImagePromptExtractor`（181 行）两个模块零测试、`engine/prompts/*` 22~37%——新增三个测试文件 28 例；engine 行覆盖 73.7% → 85%+（达路线图 G2 要求）
- **覆盖率门槛**：vite.config.ts `test.coverage` 分层设防（engine 84 / lib 45 / stores 35 / hooks 2 / components 0.5），`npm run test:coverage` 不达标 exit 1；**坑：vitest 对象式门槛中裸数字键只管未被 glob 覆盖的文件，必须用 glob 分区覆盖全部 include 目录**
- **CI 增强**：Linux job 补 check-version + lint + test:coverage + cargo test（原只有 tsc/vitest/cargo check）；新增 `check-windows` job（tsc + vitest，主用户平台）

**关键决策及理由**：
- 门槛=实测基线设防而非路线图 75% 直设：组件层 0%、hooks 3% 的现状下 75% 必挂 CI，质量门沦为摆设；分层锁线 + HANDOFF 记录 ratchet 计划（每次补测手动上调）是当下诚实且有效的做法；engine 一层已按路线图要求达到 85%
- Windows job 不跑 Rust：Windows Rust 编译 15 分钟起，收益低；Windows 特有的 jsdom/路径问题由 tsc+vitest 覆盖

**验证方式与结果**：本地全绿——check-version exit 0、eslint 0 error（新文件 0 告警）、tsc exit 0、vitest 463/463 + 覆盖率门槛 exit 0、cargo check/test ok、build 2.8s。CI 结果待推送后观察。

**遗留问题**：
- 覆盖率 ratchet 计划：components（0.61%）与 hooks（2.97%）是下两个补测目标；SmartFollowup 46%、QuestionLoader 62% 是 engine 内余量
- CI 的 Windows job 首跑结果需确认（jsdom 在 windows-latest 的表现）

### CSP 修复轮（2026-10-25 傍晚）— RAG 嵌入模型下载放行

**任务目标与用户决策**：执行 backlog P0 的 CSP 修复任务卡（用户「开始」指令）。此前 vectorStore 运行时下载嵌入模型会被 Tauri CSP connect-src 拦截，Tauri 客户端内 RAG 向量库首建失败。

**实际完成内容**：
- `tauri.conf.json` connect-src 精确追加 `https://huggingface.co`（transformers.js 默认 remoteHost，源码实证）与 `https://cas-bridge.xethub.hf.co`（HF 模型文件 302 跳转的 CDN 域，预置放行）；未用 `https:` 通配，SSRF 防护边界不变
- **验证方式演进（本轮最重要教训）**：先走 dev 实例 UI 路径（设置→高级功能→RAG 区），发现两件事：① 空历史时 RAG「就绪」是空库降级态，模型不会加载（`ensureInit`/`reindex` 在 `recentQA.length===0` 时跳过 `indexQABatch`）；② **dev 模式 Vite 返回的 HTML 完全没有 CSP**（Tauri 仅在构建时向产物注入，dev 需配 `devCsp` 才有）——dev 实例根本测不了生产 CSP，UI 路径就此放弃
- **改为产物级验证**：本地 `npx tauri build`（带签名）→ 对 `target/release/linggandawang.exe` 二进制 grep，**明文提取到完整新 CSP**（含两个新域名）——证明注入链路端到端生效；transformers 默认域名 + CSP 语法静态校验 PASS + 二进制嵌入 = 证据链闭合
- 顺带实证：新最小化按钮在 dev 实例头部正常渲染（多轮观察确认）

**关键决策及理由**：
- cas-bridge 域名预置放行而非等实测失败：HF 的 resolve URL 302 到 Xet CDN 是当前已知行为，等 0.9.1 真实用户流量反馈再收窄；若后续出现 `cdn-lfs.huggingface.co` 等其他跳转域，按 0.9.2 迭代补
- 不在 dev 加 `devCsp`：增量铁律，且 devCsp 与生产 CSP 漂移反而制造假阴性

**验证方式与结果**：CSP 语法静态校验 PASS；vitest 422/422；tsc exit 0；build 2.66s；check-version exit 0；产物二进制含新 CSP（grep 实证）。

**遗留问题**：
- 运行时最终确认归属 0.9.1 真实使用：Tauri 客户端内产生历史 QA → 自动建索引 → 模型下载成功且 RAG 区显示「已索引 N 条」；若出现新 CDN 域名被拦，追加域名发 0.9.2
- 本次 `tauri build` 产物（`target/release/bundle/nsis/LingGanDaWang_0.9.0_x64-setup.exe`，本地未签名验证用）未安装，仅作二进制检查；0.9.1 走正式 CI 构建


