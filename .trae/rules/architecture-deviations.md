---
alwaysApply: true
---

# Architecture Deviations（已知架构偏差）

本规则沉淀当前代码与 AGENTS.md 分层声明的已知偏差。这些均为历史决策，短期保留；但在新增/修改代码时必须遵守对应约束，避免偏差继续扩大；重构时按下述优先级解耦。

## 1. Engine Layer Depends on Stores（引擎层直接依赖 zustand stores）

- **现状**：`src/engine/` 下的 `RequirementSyncer.ts`、`LLMIntentAnalyzer.ts`、`SmartFollowup.ts`、`ImagePromptExtractor.ts` 直接 `import { useApiKeyStore } from '@/stores/apiKeyStore'`（及 `useLLMAvailabilityStore`、`appStore`），通过 `getState()` 读取 LLM 配置并驱动熔断器（调用前 `shouldAttempt()`、失败 `recordFailure()`）。
- **偏差**：与 AGENTS.md「引擎层纯业务逻辑、不依赖 Tauri API / React」的声明不符（zustand store 属于 React 生态状态层）。
- **约束**：历史决策，短期保留。**新增 engine 类不得再直接 import stores**，配置与回调通过构造参数依赖注入；重构时优先解耦上述 4 个类。

## 2. Engine Imports Types from Components（引擎反向依赖组件类型）

- **现状**：`src/engine/ScreenshotDiagnoser.ts` 顶部 `import type { DiagnosisIssue } from '@/components/DiagnosisReport'`——engine 层反向依赖 components 层导出的类型。
- **正确方向**：类型应下沉到 `src/engine/types.ts`，由 `DiagnosisReport.tsx` 改为从 engine 导入。
- **约束**：新增共享类型一律定义在 `engine/types.ts` 或 `src/types/` 下；下次触碰这两个文件时顺手完成 `DiagnosisIssue` 下沉迁移（迁移完成后更新本条）。

## 3. useFlow.ts God Hook（巨型编排 hook 与模块级可变全局）

- **现状**：`src/hooks/useFlow.ts` 约 780 行，单个 hook 承担提问流程全部编排；另有 3 个模块级可变全局变量：`engineInstance`（QuestionEngine 单例缓存）、`followupTriggeredThisSession`（会话级追问触发标记）、`startSeq`（启动序号，防旧请求竞态）。
- **风险**：模块级可变全局在测试间共享状态、热重载/多实例下相互污染；hook 继续膨胀将不可维护。
- **约束**：**新增功能不得继续往 useFlow.ts 追加逻辑**——新流程拆独立 hook 或下沉到 engine；如确需新增模块级全局，必须提供重置手段并在测试 setup 中清理。

## 4. SettingsPanel Bypasses Layering（设置面板直连 engine 的分层例外）

- **现状**：`src/components/SettingsPanel.tsx` 直接 `import { questionLoader } from '@/engine/QuestionLoader'`，绕过 hooks 编排层，违反「UI 层不直接调用 engine/lib」的分层约束（`ExpandedCard.tsx` 存在同类直连 engine 单例的例外）。
- **约束**：作为已知分层例外短期保留。**新组件一律通过 hooks/stores 访问 engine**，不再新增 UI→engine 直连；重构时将 questionLoader 等单例调用收编进 hooks 层。
