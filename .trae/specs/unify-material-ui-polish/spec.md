# 统一材质与整体视觉优化 Spec

## Why

主面板（window-panel）已改为实色材质，但引导层 OnboardingOverlay 仍残留 `backdrop-blur-xl` 毛玻璃，材质体系割裂；阴影 token 中的 `0 0 0 1px` 白描边环与 border 叠加形成双重灰边；虚线边框、分段控件选中态反层级、越规小字号（9-11px）、弹层无入场动画等问题共同造成界面视觉割裂感。

## What Changes

- **BREAKING（视觉层）**：全面废除 `backdrop-filter`/`backdrop-blur`，确立三级实色材质规范（window / popover / inset）
- 修正阴影 token：移除 `--shadow-window`、`--shadow-popover`（含 tailwind boxShadow 对应值）中的 `0 0 0 1px` 描边环，消除双重边
- 浮层边框统一为 1px `rgba(255,255,255,0.10)`（border-light），内部控制件保持 0.06
- 虚线边框改实线：截图拖入区、图片拆解按钮、参考图上传区
- 分段控件（场景/模式）选中态由"比容器更暗"改为"比容器更亮"（bg-surface-3）
- 越规字号（9/10/11px）归一到规范下限 12px
- 弹层（Ball 菜单、模式下拉、灵感菜单、引导卡片）增加 150ms pop-in 入场动画
- 全局 `button { transition: all }` 及热路径 `transition-all` 改为属性指定过渡（性能）
- 重建 dist 与桌面端 release exe 并做浏览器视觉验证

## Impact

- Affected specs: 视觉材质规范、阴影 token、排版规范、动效规范
- Affected code:
  - `src/styles/tokens.css`、`tailwind.config.ts`、`src/index.css`（token 与工具类）
  - `src/components/OnboardingOverlay.tsx`（去毛玻璃）
  - `src/components/Ball.tsx`、`LLMModeBadge.tsx`、`SettingsPanel.tsx`、`ProjectPanel.tsx`、`ProjectScanDashboard.tsx`、`PrivacyDialog.tsx`、`SkipConfirmDialog.tsx`（浮层边框/动画）
  - `src/components/ExpandedCard.tsx`、`ScreenshotDropZone.tsx`、`ReferenceImagePanel.tsx`（虚线改实线、分段控件）
  - `src/components/ProjectOnboarding.tsx`、`ClusterAnalyticsPanel.tsx`、`DiagnosisReport.tsx`（字号归一）

## ADDED Requirements

### Requirement: 三级实色材质规范

系统 SHALL 采用三级实色材质，且 SHALL NOT 在任何组件使用 `backdrop-filter` / `backdrop-blur`：

| 层级 | 背景 | 边框 | 阴影 |
|---|---|---|---|
| window（主面板） | `rgba(18,18,24,0.97)` | 1px `rgba(255,255,255,0.10)` | 顶部 1px 内发光 + 双层投影 |
| popover（菜单/弹层/对话框） | `#12121c` 不透明 | 1px `rgba(255,255,255,0.10)` | popover 分层投影（无描边环） |
| inset（输入框/选项卡等内部件） | `#1a1a28`（surface-2） | 1px `rgba(255,255,255,0.06)` | 无 |

#### Scenario: 引导层材质统一

- **WHEN** 首次启动打开引导层（OnboardingOverlay）
- **THEN** 卡片为实色材质（无 backdrop-filter），边框为 border-light，与主面板边缘质感一致

#### Scenario: 浮层边缘清晰

- **WHEN** 打开 Ball 右键菜单 / 模式下拉 / 设置面板
- **THEN** 浮层为 1px 0.10 白边 + 分层投影，无双重灰边、无模糊透底

### Requirement: 弹层入场动画

所有 popover 级浮层 SHALL 使用 150ms `pop-in` 入场动画（opacity 0→1 + scale 0.96→1，`var(--ease-out)`）。

#### Scenario: 菜单弹出

- **WHEN** 用户右键悬浮球或点击模式下拉
- **THEN** 菜单以 150ms pop-in 出现，无突兀闪现

### Requirement: 排版下限

用户可见文本 SHALL 不小于 12px（规范字号阶梯 12/14/18/24）。

#### Scenario: 小字号归一

- **WHEN** 渲染模式徽章、项目引导卡、聚类分析面板等组件
- **THEN** 原 9/10/11px 文本以 12px 渲染，布局不溢出不截断异常

## MODIFIED Requirements

### Requirement: 阴影 token 去双重边

`--shadow-window`、`--shadow-popover` 及 tailwind `boxShadow.window/popover` SHALL 移除 `0 0 0 1px rgba(255,255,255,0.06)` 描边环（边缘由 border 单独承担）；`--shadow-window` 更新为 v2 分层值（inset 顶部光 + 24px/8px 双层投影）。

#### Scenario: token 一致性

- **WHEN** 检查 tokens.css 与 tailwind.config.ts
- **THEN** 两处阴影值一致且不含描边环

### Requirement: 分段控件层级修正

分段控件（场景选择 / 流程模式）选中项 SHALL 比容器背景更亮：选中 `bg-surface-3 + text-text-primary + font-medium`，未选中 `text-text-tertiary`，容器保持 `bg-surface-2`。

#### Scenario: 选中态可读

- **WHEN** 用户切换"自动检测/前端/后端/PPT"或"直接生成/快速提问/详细诊断"
- **THEN** 选中项呈亮块浮起，未选中项安静退后

### Requirement: 拖放/上传区实线化

截图拖入区、图片拆解按钮、参考图上传区 SHALL 使用 1px 实线边框（默认 border-light，拖入/悬停态 border-brand + brand/10 背景），不再使用 dashed。

#### Scenario: 拖入反馈

- **WHEN** 用户拖拽图片悬停到截图区
- **THEN** 边框变品牌紫、背景微亮，释放后恢复

## REMOVED Requirements

### Requirement: 毛玻璃材质

**Reason**: Tauri 窗口 `transparent: true`，backdrop 为用户桌面壁纸，模糊效果不可控（亮色壁纸下文字对比度下降）且常驻 GPU 开销；原实现 0.98 不透明背景下 blur 实际不可见，属无效渲染。
**Migration**: 全部替换为三级实色材质规范；OnboardingOverlay 的 `backdrop-blur-xl` 移除。
