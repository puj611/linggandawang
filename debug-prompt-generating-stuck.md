# Debug Session: prompt-generating-stuck

> Status: [OPEN]
> Created: 2026-08-01
> Session ID: `prompt-generating-stuck`
> Symptom: 用户在使用「灵感大王」过程中频繁出现"正在生成提示词"界面卡住，无法恢复

## 1. 问题描述

**实际行为**：完成提问流程后，UI 显示"正在生成提示词"loading 界面，长时间不消失，无法进入结果态。
**预期行为**：`finishAndGenerate` 完成后 `setResult(prompt)` + `transition('result')` 应在数秒内完成，进入结果面板。

## 2. 关键代码路径

```
useFlow.answer()/skip()/finishEarlyAndGenerate()/directGenerate()
  └─ finishAndGenerate()
       ├─ ctxStore.appendRecentQAs(pending)   ← 在 try 块外，可能 reject
       ├─ retrieveSimilar(seedInput, 3)        ← 有 5s 超时保护
       ├─ try {
       │    promptGenerator.generate(...)      ← 同步
       │    setResult(prompt)                  ← 设置 result，UI 不再显示 loading
       │    await ctxStore.setIntentTags(...)
       │    await ctxStore.setLastPrompt(...)
       │    await ctxStore.appendPreferences(...)
       │  } catch (genErr) { transition('expanded'); return; }
       └─ transition('result')
```

`ResultPanel.tsx` 第 35-56 行：当 `result === null` 时显示"正在生成提示词"loading。

## 3. 可证伪假设

| # | 假设 | 证伪方式 |
|---|------|----------|
| H1 | `ctxStore.appendRecentQAs` 在 try 块外，若 Tauri `save_context` invoke 卡死或 reject，会导致 `finishAndGenerate` reject 并传播为 unhandled rejection，UI 永久卡在 loading（`currentQuestion` 已被设为 null，但 `result` 未设置） | 插桩测量 `appendRecentQAs` 的开始/结束/耗时；同时捕获其 reject 原因 |
| H2 | `setResult(prompt)` 之后到 `transition('result')` 之间某个持久化 await（`setIntentTags` / `setLastPrompt` / `appendPreferences`）卡死，导致永远到不了 `transition('result')` | 插桩测量三个持久化 await 的开始/结束 |
| H3 | `retrieveSimilar` 内部 `getEmbedder()` 首次加载 90MB 模型时 `embed(query)` 卡住，虽然外层有 5s `Promise.race`，但 race 失败后 `queryEmbedding.every(v => v === 0)` 判断可能误判非全零 | 插桩测量 retrieveSimilar 入口/出口/耗时及返回条数 |
| H4 | `promptGenerator.generate` 同步函数内部某条路径抛异常被 try/catch 捕获，`transition('expanded')` 已执行，但 React 状态更新批处理延迟导致用户看到 loading 闪现后误以为卡住 | 插桩测量 generate 入口/出口，以及异常分支 |
| H5 | `useFlow.answer()` 中 `await generateFollowupQuestion(decision)` 后的 `if (!mountedRef.current) return;` 在某些边界条件下误触发，提前返回导致 `finishAndGenerate` 未被调用 | 插桩测量 mountedRef.current 值及 finishAndGenerate 是否被调用 |

## 4. 调试计划

1. 启动 Debug Server（HTTP 收集日志，端口自动探测）
2. 在 `useFlow.ts` 关键节点插桩：`finishAndGenerate` 入口、各 await 点、setResult、transition
3. 在 `contextStore.ts` 插桩：`appendRecentQAs` / `setIntentTags` / `setLastPrompt` 的 enqueue 入口与 task 完成点
4. 在 `vectorStore.ts` 插桩：`retrieveSimilar` 入口/出口/超时降级路径
5. 请用户复现"卡住"场景，收集日志
6. 根据日志判定 H1-H5 哪个成立
7. 实施最小修复
8. 二次验证（post-fix logs）
9. 用户确认后清理

## 5. 进度记录

- [x] Step 1-2: 创建 debug 文件、列出假设
- [x] Step 3: 启动 Debug Server — `http://127.0.0.1:7777`，session=`prompt-generating-stuck`，outdir=`C:\Users\puj\AppData\Local\Temp\linggandawang-debug`（项目目录 `.dbg` 被沙箱拒绝，改用 Temp）
- [x] Step 4: 插桩日志 — `src/lib/debugReporter.ts` 已创建；`src/hooks/useFlow.ts` 的 `finishAndGenerate` 关键节点已插桩（H1/H2/H3/H4/H5 观测点）。`contextStore.ts` / `vectorStore.ts` 暂未插桩，先看主路径证据再决定是否细化
- [ ] Step 5: 用户复现并收集日志
- [ ] Step 6: 证据分析
- [ ] Step 7: 最小修复
- [ ] Step 8: 二次验证
- [ ] Step 9: 清理

## 6. 日志文件

- 运行时日志：`C:\Users\puj\AppData\Local\Temp\linggandawang-debug\trae-debug-log-prompt-generating-stuck.ndjson`
- 环境文件：`C:\Users\puj\AppData\Local\Temp\linggandawang-debug\prompt-generating-stuck.env`
- 日志查询 API：
  - `GET http://127.0.0.1:7777/health`
  - `GET http://127.0.0.1:7777/logs?last=100`
  - `GET http://127.0.0.1:7777/logs?hypothesisId=H1`
  - `DELETE http://127.0.0.1:7777/logs`

## 7. 插桩点清单（useFlow.ts）

| 插桩点 | 行号 | 假设 |
|--------|------|------|
| `finishAndGenerate.enter` | ~399 | H1 |
| `appendRecentQAs.start/end/error` | ~405-413 | H1 |
| `retrieveSimilar.start/end/error` | ~428-443 | H3 |
| `promptGenerator.generate.start/end/error` | ~449-498 | H4 |
| `setResult.done` | ~468 | H1 |
| `persist.start/setIntentTags.done/setLastPrompt.done/appendPreferences.done/end/error` | ~473-491 | H2 |
| `finishAndGenerate.exit` | ~504 | H1（确认 transition('result') 到达）|

> H5（`answer()` 中 `mountedRef.current` 提前返回）目前未单独插桩；若主路径日志显示 `finishAndGenerate.enter` 从未出现，则 H5 成立，届时补插桩。
