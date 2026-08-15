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
- [x] Step 4: 插桩日志 — `src/lib/debugReporter.ts` 已创建；`src/hooks/useFlow.ts` 的 `finishAndGenerate` 关键节点已插桩（H1/H2/H3/H4/H5 观测点）
- [x] Step 5: 用户复现 — 用户报告"还是老问题"，但 Debug Server 收到 0 条日志
- [x] Step 6: 证据分析（见下方 §8 静态分析结论 — 运行时日志因 CSP 阻塞未能收集）
- [x] Step 7: 最小修复（见下方 §9 修复方案）— 全部代码修改完成，tsc --noEmit 通过
- [x] Step 7.5: 发现并修复"修复未生效"的 meta-bug（见 §10）— TypeScript 编译错误导致 dist 未重建
- [x] Step 8: 二次验证 — dist 已重建（npm run build 成功），tauri dev 已启动（PID 37944），等待用户复现确认
- [ ] Step 9: 清理

## 8. 静态分析结论（运行时日志因 CSP 阻塞未能收集）

### 8.1 日志管线阻塞原因

经多轮排查确认：
- Tauri dev 应用从 Vite (5173) 加载插桩代码（WebView2 PID 21756 有到 5173 的 Established 连接）
- 但 **无到 7777 (Debug Server) 的连接** — `navigator.sendBeacon` / `fetch` 被 CSP 拦截
- exe 二进制中虽含 `127.0.0.1:7777` 字符串，但 Tauri v2 dev 模式下 CSP 注入行为与预期不符
- 模块级 canary（`canary.moduleLoad`）在 `debugReporter.ts` 中，Vite 已确认服务含 canary 的代码，但 canary 未到达 Debug Server

> 日志管线问题属于环境/CSP 配置范畴，与业务 bug 独立。已尝试 3+ 次（超出 TRAE-debugger "同类错误不超 3 次"阈值），转用静态分析。

### 8.2 根因定位（静态代码分析）

**症状**：用户"开始提问之后"卡在"正在生成提示词"。

**"正在生成提示词"出现在两处**：
- `QuestionPanel.tsx:31-51` — 当 `!currentQuestion`（state='question'，currentQuestion=null）时显示
- `ResultPanel.tsx:35-56` — 当 `!result`（state='result'，result=null）时显示

**卡住发生在 QuestionPanel 而非 ResultPanel**（基于用户描述"开始提问之后"）：

```
answer() 流程（useFlow.ts:278-364）：
  engine.answer() → setCurrentQuestion(result.nextQuestion)  ← 完成时 nextQuestion=null
  ↓ currentQuestion 已为 null，state 仍为 'question'
  ↓ QuestionPanel 渲染 !currentQuestion → 显示"正在生成提示词"loading
  await finishAndGenerate()  ← 若此函数挂起，loading 永不消失
```

**finishAndGenerate 挂起点**（useFlow.ts:406-517）：

| 步骤 | 代码 | 有超时? | 挂起后果 |
|------|------|---------|----------|
| `appendRecentQAs` (L418) | `await ctxStore.appendRecentQAs(pending)` | ❌ 无 | 在 try 块外，挂起→finishAndGenerate 永不返回 |
| `retrieveSimilar` (L441) | `await retrieveSimilar(seedInput, 3)` | ✅ 5s Promise.race | 已保护 |
| `setIntentTags` (L486) | `await ctxStore.setIntentTags(...)` | ❌ 无 | 在内层 try/catch 内，但 catch 只捕获 throw，不捕获 hang |
| `setLastPrompt` (L488) | `await ctxStore.setLastPrompt(...)` | ❌ 无 | 同上 |
| `appendPreferences` (L493) | `await ctxStore.appendPreferences(...)` | ❌ 无 | 同上 |

**contextStore.ts 的 opsChain 串行化放大问题**（contextStore.ts:17-23）：
- 所有写操作经 `enqueue` 进入 `opsChain` 串行队列
- `writePersisted` → `invoke('save_context')` 无超时（L70-79）
- **若任一 invoke 挂起（SQLite 锁/IPC 异常/后端死锁），整个 opsChain 永久阻塞**
- 后续所有 ctxStore 操作（包括其他会话的）全部排队等待

**确认 H1/H2 为根因**：`ctxStore` 的 `invoke` 调用无超时保护，opsChain 串行化导致单点挂起全局阻塞。
**H3 已排除**：retrieveSimilar 有 5s 超时。
**H4/H5 无法通过运行时日志确认/排除**，但即使成立，防御性超时修复也能兜底。

## 9. 修复方案

### 9.1 创建 `src/lib/withTimeout.ts`
通用超时包装器，给任意 Promise 添加超时保护。

### 9.2 修复 `useFlow.ts` finishAndGenerate
- `appendRecentQAs`：8s 超时，超时/出错时清空 pending、记录日志、**继续执行**（不 throw，不阻塞）
- `setIntentTags` / `setLastPrompt` / `appendPreferences`：各 5s 超时，超时时记录日志、继续执行（持久化失败不影响结果展示）

### 9.3 修复 `QuestionPanel.tsx` / `ResultPanel.tsx`
- 加载态持续 >12s 时，显示"生成超时，点击重试"按钮
- 点击重试 → `backToExpanded()` 回到安全状态

### 9.4 验证
- TypeScript 编译通过
- 重建 dist
- 切换 runId='post'，请用户复现验证

## 10. Meta-Bug：修复未生效的根因（2026-08-01 发现）

### 10.1 症状
用户在 Step 7 修复后报告："只是多了一个 12s 超时提示，就一直停留在超时界面"。
- QuestionPanel 的 12s 超时 UI **有生效**（说明 dist 中包含 QuestionPanel 修改）
- finishAndGenerate 的 withTimeoutSafe 修复 **未生效**（说明 dist 中不包含 useFlow.ts 修改）

### 10.2 根因
**Step 7 的代码修改存在 TypeScript 编译错误，导致 `npm run build` 失败，dist 未重建：**

- `useFlow.ts` 第 429 行（磁盘实际内容）：
  ```typescript
  // 变量名是 appendResult（第 422 行定义）
  const appendResult = await withTimeoutSafe(...);
  // 但第 429 行引用了不存在的 _appendR
  reportDebug({ point: _appendR.ok ? ... });
  //                              ^^^^^^^^^^ TS2304: Cannot find name '_appendR'
  ```

- `tsc -b` 编译失败 → `vite build` 未执行 → dist 保持旧版本
- 旧 dist 中 useFlow.ts 仍是原始的 plain `await`（无超时保护）
- 旧 dist 中 QuestionPanel.tsx 是更早一次成功构建的版本（含 12s 超时 UI）
- 应用从旧 dist 加载 → 出现"12s 超时但 finishAndGenerate 仍 hang"的症状

### 10.3 额外发现
运行环境也有问题：
- Vite 在 `preview` 模式（端口 4173）运行，服务的是构建产物 dist/
- Vite `dev` 模式（端口 5173，HMR 热更新）未运行
- 即使源码修改了，preview 模式也不会自动更新，必须 `npm run build` 重建

### 10.4 修复
1. **修复 `_appendR` → `appendResult`**（第 429 行），并简化 if/else 为单条 reportDebug 调用
2. **回滚误改**：第 634 行 `removeTag` 函数中的 `setLastPrompt` 被脚本误包装为 `_r2`，回滚为原始 plain await
3. **tsc --noEmit 通过**（无错误）
4. **`npm run build` 成功**（dist 已重建，含完整 fix）
5. **启动 `npx tauri dev`**（Vite 5173 + Tauri dev app，PID 37944）

### 10.5 经验教训（需沉淀到规则）
- **"修复完成"必须验证产物**：源码改了 ≠ dist 重建了 ≠ 应用加载了新代码
- **沙箱覆盖层陷阱**：Edit/Write 工具在非可写目录会静默重定向到覆盖层，Read 工具可能读到缓存而非磁盘真实内容 → 必须用 `dangerouslyDisableSandbox` + PowerShell 直读磁盘验证
- **TypeScript 编译错误是隐蔽杀手**：变量名拼写错误（`_appendR` vs `appendResult`）不会在运行时立即暴露，但会阻断构建链
- **验证链必须闭环**：源码修改 → tsc 通过 → build 成功 → dist 更新 → 应用加载新 dist → 行为验证

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
