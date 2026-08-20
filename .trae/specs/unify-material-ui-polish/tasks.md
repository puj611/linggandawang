# Tasks

- [x] Task 1: 材质与阴影 token 统一（基础层，后续任务依赖）
  - [x] 1.1 `src/styles/tokens.css`：`--shadow-window` 更新为 v2 值（`inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 48px -12px rgba(0,0,0,0.60), 0 8px 16px -8px rgba(0,0,0,0.40)`）；`--shadow-popover` 移除 `0 0 0 1px` 环改为 `0 12px 32px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.30)`；新增 `--shadow-popover-in` 不需要则跳过
  - [x] 1.2 `tailwind.config.ts`：`boxShadow.window` / `boxShadow.popover` 同步 1.1 的值（保持与 CSS 变量一致）
  - [x] 1.3 `src/index.css`：新增 `@keyframes popIn`（opacity 0 + scale 0.96 → 1）与 `.animate-pop-in { animation: popIn 150ms var(--ease-out) forwards; transform-origin: top right; }`；将全局 `button { transition: all 150ms }` 改为 `transition: color 150ms, background-color 150ms, border-color 150ms, opacity 150ms, transform 150ms, box-shadow 150ms`
  - [x] 1.4 验证：`tsc -b` 通过；grep 确认 tokens.css/tailwind.config.ts 无 `0 0 0 1px`

- [x] Task 2: 去毛玻璃 + 浮层材质统一（依赖 Task 1）
  - [x] 2.1 `OnboardingOverlay.tsx:34`：`bg-surface-1/95 backdrop-blur-xl` → `bg-surface-1`，并追加 `animate-pop-in`
  - [x] 2.2 浮层边框 0.06→0.10：`Ball.tsx:191`、`LLMModeBadge.tsx:101`、`InspireButton.tsx:73`（window-panel 已是 0.10 不动）、`SettingsPanel.tsx:116`、`ProjectPanel.tsx:145`、`ProjectScanDashboard.tsx:110`、`PrivacyDialog.tsx:34`、`SkipConfirmDialog.tsx:29` 的 `border-border` 改为 `border-border-light`
  - [x] 2.3 弹层入场动画：`Ball.tsx:191` 菜单、`LLMModeBadge.tsx:101` 下拉、`InspireButton.tsx:73` 菜单追加 `animate-pop-in`
  - [x] 2.4 验证：grep 确认 src 下无 `backdrop-blur`/`backdrop-filter` 残留

- [x] Task 3: 控件视觉修正（依赖 Task 1，可与 Task 2 并行）
  - [x] 3.1 分段控件选中态：`ExpandedCard.tsx:307-337` 两处 `bg-surface-1` → `bg-surface-3`（选中更亮）
  - [x] 3.2 虚线改实线：`ScreenshotDropZone.tsx:29/42`（`border-2 border-dashed` → `border border-border-light`，拖入态保持 `border-brand bg-brand/10`）、`ExpandedCard.tsx:375`（`border-dashed` → 实线）、`ReferenceImagePanel.tsx:179/215`（`border-dashed` → 实线）
  - [x] 3.3 字号归一到 12px 下限：`LLMModeBadge.tsx`（9px→12px，含 87/144/151 行）、`ProjectOnboarding.tsx`（10/11px→12px）、`DiagnosisReport.tsx:59`（10px→12px）、`ClusterAnalyticsPanel.tsx`（9/10px→12px，批量替换 text-[9px]/text-[10px]/text-[11px]）；`ExpandedCard.tsx:340` 字符计数 12px 保持；注意替换后检查容器不溢出（徽章宽度允许自适应）
  - [x] 3.4 热路径 transition-all 收敛：`ExpandedCard.tsx:239/254/265/307/329`、`Ball.tsx:155`、`ClusterAnalyticsPanel.tsx:143/148` 的 `transition-all` 改为具体属性（color/background-color/transform/border-color）
  - [x] 3.5 验证：`tsc -b` 通过

- [x] Task 4: 构建与视觉验证（依赖 Task 1-3）
  - [x] 4.1 `tsc -b && vite build` 重建 dist
  - [x] 4.2 启动 vite dev，浏览器验证：引导层无毛玻璃、主面板/浮层边缘清晰无双重边、分段控件选中亮块、截图区实线、无 9-11px 文本、菜单有 pop-in 动画、console 无 CSS 错误
  - [x] 4.3 备份 tauri.conf.json → 临时清空 beforeBuildCommand → `tauri build --no-bundle` → 还原配置 → 启动 release exe 确认桌面端生效

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 依赖 Task 1（与 Task 2 可并行）
- Task 4 依赖 Task 2、Task 3

