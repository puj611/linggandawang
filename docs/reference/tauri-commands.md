# Tauri 命令接口文档

> 本文档描述 `src-tauri/src/lib.rs` 中注册的全部 28 个 Tauri command。
> 前端通过 `@tauri-apps/api/core` 的 `invoke()` 调用这些命令。
> 命令实现按职责拆分在 `src-tauri/src/commands/` 下：context / window / image / api_key / llm_proxy / project / requirement / sidecar（项目扫描底层实现在 `src-tauri/src/scanner.rs`）。

## 调用约定

```typescript
import { invoke } from '@tauri-apps/api/core';

// 无参数
const result = await invoke<ReturnType>('command_name');

// 带参数
const result = await invoke<ReturnType>('command_name', { arg1: value1 });
```

**错误处理**：所有命令返回 `Result<T, String>`，Rust 端 `Err(String)` 在前端表现为 `Promise.reject(string)`。

## 命令注册表

命令在 `lib.rs` 的 `tauri::generate_handler![]` 中注册（第 73-110 行）。

---

## 一、上下文管理（3 个）

### 1.1 save_context

保存上下文 JSON 到 `~/.linggandawang/context.json`。

```typescript
interface ContextPayload {
  content: string;  // JSON 字符串
}
invoke<void>('save_context', { payload: { content: '{...}' } });
```

- **调用方**：`src/stores/contextStore.ts`
- **错误**：文件写入失败时返回错误信息
- **覆盖**：直接覆盖写入，不做合并

### 1.2 load_context

从 `~/.linggandawang/context.json` 读取上下文。

```typescript
const content = invoke<string>('load_context');
// 返回：JSON 字符串，文件不存在时返回空字符串 ''
```

- **调用方**：`src/stores/contextStore.ts`
- **安全**：仅读取应用配置目录下的文件

### 1.3 archive_context

将当前 context.json 归档到 `~/.linggandawang/archive/context-{timestamp}.json` 并删除原文件。

```typescript
invoke<void>('archive_context');
```

- **调用方**：`src/stores/contextStore.ts` 的 `archiveIfStale()`（超时 24h 触发）
- **时间戳格式**：`YYYY-MM-DDTHH-MM-SS`（Local）

---

## 二、用户偏好管理（2 个）

### 2.1 save_user_preference

保存单个偏好键值对到 `~/.linggandawang/user-preferences.json`。

```typescript
interface UserPreferencePayload {
  key: string;
  value: string;
}
invoke<void>('save_user_preference', { payload: { key: 'theme', value: 'dark' } });
```

- **调用方**：`src/lib/sqlite.ts` 的 `setPreference()`
- **合并**：读取现有 JSON → 插入/覆盖指定 key → 写回

### 2.2 load_user_preference

读取单个偏好值。

```typescript
const value = invoke<string | null>('load_user_preference', { key: 'theme' });
// 返回：值字符串，不存在时返回 null
```

- **调用方**：`src/lib/sqlite.ts` 的 `getPreference()`

---

## 三、API Key 安全存储（3 个）

### 3.1 save_api_key

将 API Key 存入 Windows Credential Manager（通过 keyring crate）。

```typescript
invoke<void>('save_api_key', { provider: 'deepseek', apiKey: 'sk-xxx' });
```

- **调用方**：`src/stores/apiKeyStore.ts`
- **服务名**：`linggandawang`（keyring entry 的 service 字段）
- **provider 校验**：仅允许 `openai` / `deepseek` / `tongyi` / `custom`，其他返回错误
- **安全**：密钥不经过文件系统，直接写入操作系统凭据管理器

### 3.2 load_api_key

从 Credential Manager 读取 API Key。

```typescript
const apiKey = invoke<string | null>('load_api_key', { provider: 'deepseek' });
// 返回：密钥字符串，不存在时返回 null
```

- **调用方**：`src/stores/apiKeyStore.ts`

### 3.3 delete_api_key

删除指定服务商的 API Key。

```typescript
invoke<void>('delete_api_key', { provider: 'deepseek' });
```

- **调用方**：`src/stores/apiKeyStore.ts`
- **注意**：keyring v3 API 使用 `delete_credential()`（非 `delete_password()`）
- **幂等**：条目不存在时也返回 `Ok(())`

---

## 四、问题库管理（3 个）

### 4.1 load_user_bank

读取用户自定义问题库 `~/.linggandawang/user-bank.yaml`。

```typescript
const content = invoke<string>('load_user_bank');
// 返回：YAML 字符串，文件不存在时返回空字符串 ''
```

- **调用方**：`src/engine/QuestionLoader.ts` 的 `preloadUserBank()`

### 4.2 save_user_bank

保存用户自定义问题库。

```typescript
interface UserBankPayload {
  content: string;  // YAML 字符串
}
invoke<void>('save_user_bank', { payload: { content: '...' } });
```

- **调用方**：设置面板（用户编辑问题库时）

### 4.3 clear_user_bank

删除用户自定义问题库文件。

```typescript
invoke<void>('clear_user_bank');
```

- **幂等**：文件不存在时也返回 `Ok(())`

---

## 五、窗口位置持久化（2 个）

### 5.1 save_window_position

保存窗口位置到 `~/.linggandawang/window-position.json`。

```typescript
interface WindowPositionPayload {
  x: number;
  y: number;
  screen: string;
}
invoke<void>('save_window_position', { payload: { x: 100, y: 200, screen: 'main' } });
```

- **调用方**：`src/stores/windowStore.ts`

### 5.2 load_window_position

读取持久化的窗口位置。

```typescript
interface WindowPositionResult {
  x: number;
  y: number;
  screen: string | null;
}
const pos = invoke<WindowPositionResult | null>('load_window_position');
// 返回：位置对象，文件不存在时返回 null
```

- **调用方**：`src/stores/windowStore.ts` 的 `loadPosition()`

---

## 六、图片读取（1 个）

### 6.1 read_image_file

读取本地图片文件为 data URL（base64 编码）。

```typescript
interface ImageDataResult {
  data_url: string;   // data:image/png;base64,...
  width: number;      // 图片宽度（px），解析失败为 0
  height: number;     // 图片高度（px），解析失败为 0
  bytes: number;      // 原始字节数
}
const result = invoke<ImageDataResult>('read_image_file', { path: 'C:\\...' });
```

- **调用方**：`src/hooks/useTauriDropFile.ts`
- **支持的格式**：png / jpg / jpeg / gif / webp / bmp / svg
- **安全限制**：
  - 拒绝读取系统关键目录（`windows\system32`、`bootmgr`、`\etc\`、`programdata\microsoft\crypto`）
  - 文件大小限制：10MB
  - 路径会先 `canonicalize()` 再校验
- **宽高解析**：PNG 从 IHDR、JPEG 从 SOF 标记、GIF 从逻辑屏幕描述符、BMP 从 DIB header、WebP 从 VP8/VP8L/VP8X 块解析

---

## 七、项目扫描（6 个）

### 7.1 pick_project_folder

弹出系统文件夹选择对话框，返回用户选中的目录路径。

```typescript
const path = invoke<string | null>('pick_project_folder');
// 返回：绝对路径字符串，用户取消时返回 null
```

- **调用方**：`src/lib/projectScanner.ts` 的 `pickProjectFolder()`
- **实现**：使用 `tauri_plugin_dialog::DialogExt`，通过 `tokio::sync::oneshot` 将异步回调转为同步等待
- **注意**：
  - 选中的目录会记录到 `ProjectScanState`（lib.rs `.manage()` 注入），作为后续所有扫描命令的授权白名单
  - 此命令会阻塞调用线程直到用户做出选择

### 7.2 scan_project

扫描指定项目目录，返回文件结构和 package.json 信息（仅扫描一层，不递归）。

```typescript
interface PkgJsonPayload {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}
interface ScanProjectResult {
  root_path: string;
  root_files: string[];      // 根目录文件名列表（排除敏感文件）
  src_dirs: string[];        // src/ 下的子目录名列表
  root_dirs: string[];       // 根目录子目录名列表（排除隐藏目录）
  package_json?: PkgJsonPayload;
}
const result = invoke<ScanProjectResult>('scan_project', { path: 'C:\\my-project' });
```

- **调用方**：`src/lib/projectScanner.ts` 的 `scanProject()`
- **安全限制**：
  - **目录授权**：必须先通过 `pick_project_folder` 选择目录（`ProjectScanState` 白名单，`canonicalize()` 后精确匹配，见 `assert_authorized()`），否则返回错误
  - 敏感文件黑名单（30+ 模式）：`.env*`、`id_rsa`、`*.pem`、`*.key`、`credentials*`、`.aws`、`.ssh`、`secrets.*` 等（共享实现 `commands/mod.rs::is_sensitive_file`）
  - 隐藏目录（以 `.` 开头）不扫描
  - 仅扫描一层目录结构（不递归）

### 7.3 full_scan_project

深度扫描项目：文件树 + Git 状态 + 依赖图 + TODO/FIXME 一次性聚合返回（M10 项目深度扫描）。

```typescript
interface FileEntry {
  name: string;
  path: string;        // 相对项目根目录的路径
  is_dir: boolean;
  size: number;        // 字节数，目录为 0
  ext?: string;        // 小写扩展名，无扩展名为 null
}
interface FileTree {
  root: string;
  total_files: number;
  total_dirs: number;
  total_size: number;
  entries: FileEntry[];                    // 目录在前、文件在后，按名称排序
  by_extension: Record<string, number>;    // 按扩展名统计文件数
}
interface GitStatus {
  is_repo: boolean;
  branch?: string;
  changed_files: { status: string; path: string }[];   // git status --porcelain
  recent_commits: { hash: string; message: string; author: string; date: string }[]; // 最近 10 条
}
interface DependencyGraph {
  dependencies: Record<string, string>;
  dev_dependencies: Record<string, string>;
  scripts: Record<string, string>;
  tsconfig_paths?: Record<string, string>;  // tsconfig.json paths，取每条第一个目标
  lock_file?: string;                       // pnpm-lock.yaml | yarn.lock | package-lock.json | bun.lockb
}
interface TodoItem {
  file: string;
  line: number;
  tag: string;       // TODO | FIXME | HACK | XXX | WARN | BUG
  content: string;
}
interface FullScanResult {
  file_tree: FileTree;
  git: GitStatus;
  dependencies: DependencyGraph;
  todos: TodoItem[];
  scan_time_ms: number;
}
const result = invoke<FullScanResult>('full_scan_project', {
  path: 'C:\\my-project',
  maxDepth: 6,   // 可选，默认 6
});
```

- **入参**：`path: string`（必填）、`maxDepth?: number`（可选，默认 6，TODO 扫描深度上限固定 8）
- **调用方**：`src/lib/projectScanner.ts` 的 `fullScanProject()`（Web 环境返回 null）
- **注意事项**：
  - 目录授权同 7.2（`assert_authorized()` 白名单校验）
  - 忽略规则：默认忽略 `node_modules`/`target`/`dist`/`build`/`.git` 等目录 + 各类 lock 文件，并读取项目 `.gitignore` 条目（简化为按最后路径段匹配）
  - Git 部分调用系统 `git` 命令（`rev-parse` / `status --porcelain` / `log --oneline -10`），需要 PATH 中有 git；非 git 仓库返回 `is_repo: false`
  - 同步命令（非 async），大项目深度扫描会阻塞，前端调用方已做 try/catch 降级

### 7.4 scan_file_tree_cmd

单独扫描文件树（`full_scan_project` 的子能力，独立暴露）。

```typescript
const tree = invoke<FileTree>('scan_file_tree_cmd', {
  path: 'C:\\my-project',
  maxDepth: 6,   // 可选，默认 6
});
```

- **入参**：`path: string`（必填）、`maxDepth?: number`（可选，默认 6）
- **出参**：`FileTree`（结构见 7.3）
- **调用方**：当前前端无直接调用（预留命令）；底层实现 `scanner::scan_file_tree` 由 `full_scan_project` 内部组合使用
- **注意事项**：目录授权同 7.2；忽略规则同 7.3

### 7.5 git_status_cmd

单独解析 Git 状态（`full_scan_project` 的子能力，独立暴露）。

```typescript
const status = invoke<GitStatus>('git_status_cmd', { path: 'C:\\my-project' });
```

- **入参**：`path: string`（必填）
- **出参**：`GitStatus`（结构见 7.3）
- **调用方**：当前前端无直接调用（预留命令）；底层实现 `scanner::parse_git_status`
- **注意事项**：目录授权同 7.2；依赖系统 git 可执行文件；最近提交格式 `%h|%s|%an|%ai` 按竖线分割解析

### 7.6 analyze_deps_cmd

单独分析依赖图（`full_scan_project` 的子能力，独立暴露）。

```typescript
const deps = invoke<DependencyGraph>('analyze_deps_cmd', { path: 'C:\\my-project' });
```

- **入参**：`path: string`（必填）
- **出参**：`DependencyGraph`（结构见 7.3）
- **调用方**：当前前端无直接调用（预留命令）；底层实现 `scanner::analyze_dependencies`
- **注意事项**：目录授权同 7.2；解析 `package.json`（dependencies/devDependencies/scripts）+ `tsconfig.json` 的 `compilerOptions.paths`（取每条第一个目标）+ 锁文件检测（优先级 pnpm > yarn > npm > bun）

---

## 八、LLM 代理（2 个）

> 实现位于 `src-tauri/src/commands/llm_proxy.rs`。
> 安全目标：前端不持有明文 API Key（Rust 从 keyring 读取并注入 `Authorization` header）+ SSRF DNS 级校验（前端 JS 校验可被绕过，Rust 侧解析 DNS 并校验所有结果 IP 不落内网，防 DNS 重绑定）。

### 8.1 llm_proxy_chat

通过 Rust 代理发起非流式 LLM chat 请求（OpenAI 兼容 `POST {base_url}/chat/completions`）。

```typescript
interface ProxyMessage {
  role: string;      // 'system' | 'user' | 'assistant'
  content: string;   // 或多模态 ContentPart[]（原样透传）
}
interface LlmProxyChatRequest {
  provider: string;        // 'openai' | 'deepseek' | 'tongyi' | 'custom' | 'local'
  base_url: string;
  model: string;
  messages: ProxyMessage[];
  temperature?: number;    // 缺省 0.7
  max_tokens?: number;
  timeout_secs?: number;   // 业务超时（秒），缺省 120，下限 5
}
// 注意：整个请求对象包裹在 req 参数名中
const data = await invoke<OpenAIChatResponse>('llm_proxy_chat', {
  req: { provider: 'deepseek', base_url: '...', model: 'deepseek-chat', messages: [...], timeout_secs: 8 },
});
// 返回：OpenAI chat/completions 响应原样 JSON（choices[0].message.content / model / usage）
```

- **入参**：`req: LlmProxyChatRequest`（必填，注意 invoke 参数名为 `req`）
- **出参**：`serde_json::Value`（OpenAI 响应原样 JSON，由前端解析 `choices[0].message.content`）
- **调用方**：`src/lib/llm/openai-adapter.ts` 的 `chatViaProxy()`（`chat()` 在 Tauri 环境自动走此代理）
- **注意事项**：
  - **timeout_secs**：业务超时由前端按调用场景传入（如意图分析 8s、图片拆解 20s）；Rust 侧用 `tokio::time::timeout` 真正中断 reqwest，实现副作用可回收的取消（不占住 worker 120s）；同时作为 reqwest 客户端超时，下限 5s
  - 密钥代理注入：Rust 从 keyring（service=`linggandawang`）读取，前端不接触明文 key；`provider: 'local'` 无需 key（空串，不带 Authorization header）
  - SSRF 校验：仅允许 HTTPS（`localhost`/`127.0.0.1` 例外允许 HTTP）+ DNS 解析所有结果 IP 不得落入内网/保留地址（IPv4 私有段/CGNAT/链路本地 + IPv6 回环/唯一本地/链路本地）
  - 错误文本经 `sanitize()` 处理（去除 `Bearer ` 前缀），防止 LLM 端点回显 key 泄露
  - 不支持流式（`stream: false` 固定）；前端取消通过 signal 竞速实现（见 llm-adapter.md）

### 8.2 llm_proxy_test

通过 Rust 代理测试 LLM 连通性（`GET {base_url}/models`）。

```typescript
const ok = await invoke<boolean>('llm_proxy_test', {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',   // camelCase 自动映射 base_url
});
// 返回：HTTP 2xx 为 true，非 2xx / 网络异常为 false
```

- **入参**：`provider: string`（必填）、`baseUrl: string`（必填，Rust 参数名 `base_url`）
- **出参**：`boolean`
- **调用方**：`src/lib/llm/openai-adapter.ts` 的 `testConnection()`（Tauri 环境分支）
- **注意事项**：
  - 超时固定 10 秒
  - key 注入与 SSRF 校验逻辑同 8.1
  - 网络/HTTP 失败只返回 `false` 不抛错；仅 keyring 读取失败或 SSRF 校验失败时返回 `Err(String)`

---

## 九、需求持久化（2 个）

> 实现位于 `src-tauri/src/commands/requirement.rs`，存储到 `~/.linggandawang/requirements.json`（app_config_dir）。

### 9.1 load_requirements

读取需求列表。

```typescript
const data = await invoke<{ requirements: Requirement[] }>('load_requirements');
// 返回：{ requirements: [...] }，文件不存在时返回空数组
```

- **入参**：无
- **出参**：`{ requirements: Requirement[] }`（Rust 侧为 `Vec<serde_json::Value>`，结构由前端类型约束）
- **调用方**：`src/stores/requirementStore.ts` 的 `load()`（Tauri 失败或 Web 环境降级 localStorage，key=`linggan_requirements`）
- **注意事项**：文件存在但 JSON 解析失败时返回 `Err`（前端降级 localStorage）

### 9.2 save_requirements

保存需求列表（整体覆盖写入，pretty JSON）。

```typescript
await invoke<void>('save_requirements', { requirements: [...] });
```

- **入参**：`requirements: Requirement[]`（必填）
- **出参**：`void`
- **调用方**：`src/stores/requirementStore.ts` 的 `save()`（`addRequirement` / `removeRequirement` / `updateSubtaskStatus` / `clear` 均触发）
- **注意事项**：整体覆盖不做合并；store 侧限制最多 20 条（`MAX_REQUIREMENTS`）

---

## 十、本地 LLM sidecar（4 个）

> 实现位于 `src-tauri/src/commands/sidecar.rs`，管理本地 llama-server 进程（`provider: 'local'` 的推理后端）。
> 状态通过 `LocalLLMState`（lib.rs `.manage()` 注入）在内存中维护。

### 10.1 start_local_llm

启动本地 llama-server 进程。

```typescript
interface LocalLLMStatus {
  running: boolean;
  port: number;
  pid: number | null;
  model_path: string | null;
  error: string | null;
}
const status = await invoke<LocalLLMStatus>('start_local_llm', {
  modelPath: 'D:\\models\\qwen2.5-7b.gguf',  // 必填（camelCase 映射 model_path）
  port: 11434,      // 可选，默认 11434
  nCtx: 2048,       // 可选，上下文长度（映射 n_ctx）
  nThreads: 8,      // 可选，CPU 线程数（映射 n_threads）
});
```

- **入参**：`modelPath: string`（必填，GGUF 模型文件路径）、`port?: number`（可选，默认 11434）、`nCtx?: number`（可选，`--ctx-size`）、`nThreads?: number`（可选，`--threads`）
- **出参**：`LocalLLMStatus`
- **调用方**：`src/stores/localLLMStore.ts` 的 `start()`（端口固定传 11434）
- **注意事项**：
  - 幂等：已在运行且端口占用时直接返回当前状态
  - 模型文件不存在时不抛 `Err`，返回的 status 带 `error` 字段
  - llama-server 二进制查找顺序：PATH（which crate）→ 应用配置目录 `bin/` → 当前 exe 同目录
  - 启动参数：`-m {model} --port {port} --host 127.0.0.1 [--ctx-size] [--threads]`（仅监听本机回环）
  - 启动后等待 500ms 再做健康检查（`GET /v1/models`，3s 超时）；健康检查未通过时 `running: true` + `error: "服务启动但健康检查未通过，可能模型加载中"`

### 10.2 stop_local_llm

停止本地 llama-server 进程。

```typescript
const status = await invoke<LocalLLMStatus>('stop_local_llm');
```

- **入参**：无
- **出参**：`LocalLLMStatus`（`running: false`）
- **调用方**：`src/stores/localLLMStore.ts` 的 `stop()`
- **注意事项**：Windows 上 `child.kill()` 等价 TerminateProcess（强制终止，非优雅退出）；未运行时调用也正常返回

### 10.3 check_local_llm_health

检查本地 LLM 服务健康状态（含进程存活检测）。

```typescript
const status = await invoke<LocalLLMStatus>('check_local_llm_health');
```

- **入参**：无
- **出参**：`LocalLLMStatus`
- **调用方**：`src/stores/localLLMStore.ts` 的 `checkHealth()` + `startHealthPolling()`（每 30s 轮询）
- **注意事项**：
  - 未运行时直接返回当前状态（不发 HTTP 请求）
  - 健康检查失败时检测进程存活：Windows 用 `tasklist /FI "PID eq N"`，Unix 用 `kill -0`；进程已退出则置 `running: false` + `error: "进程已退出"`
  - 前端轮询发现 `error === '进程已退出'` 时自动重启（延迟 2s，最多 3 次，`MAX_AUTO_RESTART_ATTEMPTS`）
  - 健康检查成功则清空 `error`

### 10.4 get_local_llm_status

获取本地 LLM 服务状态（不触发健康检查）。

```typescript
const status = await invoke<LocalLLMStatus>('get_local_llm_status');
```

- **入参**：无
- **出参**：`LocalLLMStatus`
- **调用方**：`src/stores/localLLMStore.ts` 的 `loadStatus()`（应用启动时恢复状态，回填 modelPath）
- **注意事项**：仅读取内存状态（`LocalLLMState`），不做网络请求；非 Tauri 环境前端直接使用默认值

---

## 附：命令注册清单（tauri::generate_handler!，lib.rs 第 73-110 行）

```rust
// Context commands
context::save_context,
context::load_context,
context::archive_context,
context::load_user_bank,
context::save_user_bank,
context::clear_user_bank,
context::save_user_preference,
context::load_user_preference,
// Window commands
window::save_window_position,
window::load_window_position,
// Image commands
image::read_image_file,
// API Key commands
api_key::save_api_key,
api_key::load_api_key,
api_key::delete_api_key,
// LLM 代理命令（密钥注入 + SSRF 校验）
llm_proxy::llm_proxy_chat,
llm_proxy::llm_proxy_test,
// Project commands
project::pick_project_folder,
project::scan_project,
project::full_scan_project,
project::scan_file_tree_cmd,
project::git_status_cmd,
project::analyze_deps_cmd,
// Requirement commands
requirement::load_requirements,
requirement::save_requirements,
// Local LLM sidecar commands
sidecar::start_local_llm,
sidecar::stop_local_llm,
sidecar::check_local_llm_health,
sidecar::get_local_llm_status,
```

## 附：SQLite 迁移表

> 迁移在 `lib.rs` 的 `sqlite_migrations()`（第 28-61 行）注册，数据库 `sqlite:linggandawang.db`（tauri-plugin-sql）。

| 版本 | 表名 | 文件 | 用途 |
|---|---|---|---|
| 1 | prompt_history | `0001_create_prompt_history.sql` | 提示词历史记录（title/markdown/tags_json/seed_input + created_at 索引） |
| 2 | user_preferences | `0002_create_user_preferences.sql` | 用户偏好 KV 缓存 |
| 3 | question_bank_cache | `0003_create_question_bank_cache.sql` | 问题库缓存（category 索引，用于 bank.yaml 覆盖/增量更新） |
| 4 | prompt_history（ALTER） | `0004_add_favorite_to_prompt_history.sql` | 为 prompt_history 增加 `favorite` 列 + 索引（建表时遗漏，前端 SELECT/UPDATE favorite 报错的修复） |
| 5 | vector_store | `0005_create_vector_store.sql` | 向量存储表（RAG 历史答案检索，Phase C：id/text/metadata_json/created_at） |
