# 发布流程（Release Process）

> 适用范围：灵感大王桌面端（Windows NSIS / macOS DMG / Linux deb + AppImage）。
> 触发方式：推送 `v*` tag → `.github/workflows/release.yml` 自动构建并创建 draft release。
> 关联实现：Phase 5 Task 18「自动更新」（tauri-plugin-updater + tauri-plugin-process）。

## 一、一次性准备（首次发版前完成）

### 1. 生成签名密钥对

Tauri updater 强制校验更新包签名，签名不可关闭。本机执行：

```sh
npx @tauri-apps/cli signer generate -w ~/.tauri/linggan.key
```

（npm 不可用时可改用项目内 CLI：`node node_modules/@tauri-apps/cli/cli.js signer generate -w ~/.tauri/linggan.key`）

生成两个文件：

| 文件 | 用途 | 保密性 |
| --- | --- | --- |
| `~/.tauri/linggan.key` | 私钥，CI 签名用 | **绝不外泄**；丢失后已安装用户将无法再收到更新 |
| `~/.tauri/linggan.key.pub` | 公钥，写入应用配置 | 可公开 |

提示：密钥生成时可设置密码；设了密码则 CI 还需配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

### 2. 配置 GitHub Secrets

仓库 Settings → Secrets and variables → Actions → New repository secret：

| Secret 名 | 值 | 必填 |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥文件**内容**（或私钥文件路径，CI 内需可访问） | 是（启用自动更新后） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时设置的密码 | 仅密钥设了密码时 |

未配置 Secret 前打 tag：因 `tauri.conf.json` 已开启 `bundle.createUpdaterArtifacts`，构建会报
`A public key has been found, but no private key. Make sure to set TAURI_SIGNING_PRIVATE_KEY environment variable.` 并失败——这是预期门禁，先完成密钥配置再发版。

### 3. 补全 tauri.conf.json 两处占位

`src-tauri/tauri.conf.json`：

```jsonc
"plugins": {
  "updater": {
    "endpoints": [
      // 替换「你的用户名」为 GitHub 用户名/组织名
      "https://github.com/你的用户名/linggandawang/releases/latest/download/latest.json"
    ],
    "dialog": false,
    // 替换为 ~/.tauri/linggan.key.pub 的完整内容（不能是文件路径）
    "pubkey": ""
  }
}
```

当前仓库中这两处均为占位：pubkey 为空、endpoints 用户名未替换。**pubkey 为空时更新链路不生效**，
应用内「检查更新」会在运行时失败并被静默捕获（console.warn），不影响其他功能。

## 二、版本发布流程

1. **改版本号两处**（保持一致）：
   - `src-tauri/tauri.conf.json` 的 `version`（tauri-action 的 `v__VERSION__` tag 名取自这里）
   - `src-tauri/Cargo.toml` 的 `version`
   - （建议同步 `package.json` 的 `version`，仅作记录）
2. **打 tag 并推送**：
   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. **CI 自动执行**（release.yml，三平台并行）：
   - 构建前端（`npm run build`）与 Rust 产物
   - 因 `bundle.createUpdaterArtifacts: true` 且配置了 `TAURI_SIGNING_PRIVATE_KEY`，
     为各平台安装包生成 `.sig` 签名文件
   - tauri-action（`uploadUpdaterJson` 默认 true）检测到签名产物后**自动生成 `latest.json`**
     并连同安装包、`.sig` 一起上传到 draft release
4. **人工审核 draft release**（GitHub → Releases → Draft）：
   - Assets 应包含：Windows `*-setup.exe` + `.sig`；macOS `*.app.tar.gz` + `.sig` + `.dmg`；
     Linux `*.AppImage` + `.sig`、`*.deb`
   - 检查 `latest.json` 内容：`version` 与本次 tag 一致；`platforms` 各键的 `signature` 非空、
     `url` 指向本 release 的安装包资产
5. **Publish release**。发布后 `releases/latest/download/latest.json` 即指向本次版本，
   已安装旧版本的用户可在「设置 → 应用更新」中检查并升级。

## 三、latest.json 结构说明

tauri-action 自动生成，格式示例：

```json
{
  "version": "0.1.1",
  "notes": "安装包在 Assets 中下载，变更说明见 CHANGELOG.md。",
  "pub_date": "2026-08-20T00:00:00Z",
  "platforms": {
    "windows-x86_64": { "signature": "<setup.exe 的 minisign 签名>", "url": "https://github.com/.../xxx-setup.exe" },
    "darwin-universal": { "signature": "<app.tar.gz 的签名>", "url": "https://github.com/.../xxx.app.tar.gz" },
    "linux-x86_64": { "signature": "<AppImage 的签名>", "url": "https://github.com/.../xxx.AppImage" }
  }
}
```

客户端（tauri-plugin-updater）行为：按当前平台取 `platforms[target]` → 比较版本 →
下载 `url` → 用 `pubkey` 校验 `signature` → 安装 → 重启。

## 四、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| CI 报 `A public key has been found, but no private key` | `TAURI_SIGNING_PRIVATE_KEY` secret 未配置，见「一次性准备」第 2 步 |
| 应用内「检查更新」报失败 | pubkey 为空（未完成第 3 步）、endpoints 用户名占位未替换、latest.json 不存在（release 未 publish）或网络不通；前端会 console.warn `[updater] ...` |
| `latest.json` 未出现在 Assets | secret 未配置导致签名产物缺失（或构建失败）；确认 secret 后重新打 tag |
| 用户更新后仍提示旧版本 | `releases/latest` 未指向新版本（新 release 还是 draft），draft 状态的资产不可匿名下载 |

## 五、自动更新链路架构（Task 18 实现说明）

- **Rust 侧**：`tauri-plugin-updater`（setup 中注册，仅桌面平台）+ `tauri-plugin-process`
  （Builder 链注册，供重启）；自定义命令见 `src-tauri/src/commands/updater.rs`：
  - `updater_check`：检查更新，返回 `{available, version, notes, current_version}`
  - `updater_download_and_install`：下载 → 校验签名 → 安装 → `app.restart()` 重启
- **前端侧**：`src/hooks/useUpdater.ts` + `SettingsPanel.tsx` 的「应用更新」区。
  **降级方案**：node_modules 缺 `@tauri-apps/plugin-updater` / `plugin-process` JS 绑定包
  且 npm 不可用，前端经 `invoke` 调用上述 Rust 命令而非插件官方 JS API；
  待依赖可安装后可切换回 `@tauri-apps/plugin-updater` 的 `check()` / `downloadAndInstall()`
  与 `@tauri-apps/plugin-process` 的 `relaunch()`（capabilities 已预置
  `updater:default` 与 `process:allow-restart` 权限）。
- **CI 侧**：tauri-action@v0 **没有** `includeUpdater` 输入；生效机制为
  `bundle.createUpdaterArtifacts: true`（tauri.conf.json）+ `TAURI_SIGNING_PRIVATE_KEY`
  环境变量（release.yml 已注入）+ tauri-action 的 `uploadUpdaterJson`（默认 true）自动上传 latest.json。
- 更新请求由 Rust 侧发起（不走 webview fetch），不受 tauri.conf.json CSP 的 connect-src 限制。
