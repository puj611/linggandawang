# Tauri 命令接口文档

> 本文档描述 `src-tauri/src/lib.rs` 中注册的全部 16 个 Tauri command。
> 前端通过 `@tauri-apps/api/core` 的 `invoke()` 调用这些命令。

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

命令在 `lib.rs` 的 `tauri::generate_handler![]` 中注册（约第 650 行）。

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

## 七、项目扫描（2 个）

### 7.1 pick_project_folder

弹出系统文件夹选择对话框，返回用户选中的目录路径。

```typescript
const path = invoke<string | null>('pick_project_folder');
// 返回：绝对路径字符串，用户取消时返回 null
```

- **调用方**：`src/lib/projectScanner.ts` 的 `pickProjectFolder()`
- **实现**：使用 `tauri_plugin_dialog::DialogExt`，通过 `std::sync::mpsc::channel` 将异步回调转为同步等待
- **注意**：此命令会阻塞调用线程直到用户做出选择

### 7.2 scan_project

扫描指定项目目录，返回文件结构和 package.json 信息。

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
  - 敏感文件黑名单（30+ 模式）：`.env*`、`id_rsa`、`*.pem`、`*.key`、`credentials*`、`.aws`、`.ssh`、`secrets.*` 等
  - 隐藏目录（以 `.` 开头）不扫描
  - 仅扫描一层目录结构（不递归）

---

## 附：命令注册清单（tauri::generate_handler!）

```rust
save_context,
load_context,
archive_context,
load_user_bank,
save_user_bank,
clear_user_bank,
save_window_position,
load_window_position,
read_image_file,
save_user_preference,
load_user_preference,
pick_project_folder,
scan_project,
save_api_key,
load_api_key,
delete_api_key,
```

## 附：SQLite 迁移表

| 版本 | 表名 | 文件 | 用途 |
|---|---|---|---|
| 1 | prompt_history | `0001_create_prompt_history.sql` | 提示词历史记录 |
| 2 | user_preferences | `0002_create_user_preferences.sql` | 用户偏好缓存 |
| 3 | question_bank_cache | `0003_create_question_bank_cache.sql` | 问题库缓存 |
