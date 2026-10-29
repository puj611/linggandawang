# HANDOFF 归档 — v0.9.2 发版轮（2026-10-27 晚）

> 从主文档 4.3 节迁出（主文档保留最近 5 轮）。归档生成后不再修改。
> 迁出时间：2026-10-29 ｜ 原因：新增大审查轮后 4.3 达 6 轮。

## 原文
### v0.9.2 发版轮（2026-10-27 晚）— 三平台发布 + OTA 检测/下载/验签实测

**任务目标与用户决策**：执行 0.9.2 发版（上一轮已定的自然节点）。用户确认：① 打标签并推送；② 本轮就做 OTA 全链路实测；③ Publish v0.9.2。

**实际完成内容**：
- **版本 bump**（`a433c09`）：四处版本 0.9.1 → 0.9.2（package.json / tauri.conf.json / Cargo.toml / Cargo.lock 的 linggandawang 块）+ CHANGELOG 0.9.2 条目（修复/变更/性能/文档/验证/遗留六节）
- **打标签**：`v0.9.2` → `a433c09`，推送后触发 Release workflow
- **三平台构建全绿**：ubuntu（deb+appimage）/ windows / macos（universal app+dmg）三 job 均 success
- **draft 产物核验**：10 资产全部 uploaded、**全 ASCII 名**；`latest.json` version=0.9.2、**9 个平台键**、4 个主键（windows-x86_64 / linux-x86_64 / darwin-aarch64 / darwin-x86_64）齐全、签名长度 412–428、URL 全指向 ASCII 资产
- **Publish**：`releases/latest` = v0.9.2，`latest.json` 匿名可下载（HTTP 200 / 5469 字节）

**OTA 实测结果（分四段，如实定性）**：

| 段 | 结果 | 证据 |
|---|---|---|
| 检测 | ✅ 通过 | 拉 `releases/latest/download/latest.json` HTTP 200，remote=0.9.2 vs current=0.9.0，版本比较 hasUpdate=true |
| 下载 | ✅ 通过 | `windows-x86_64` 条目指向 `LingGanDaWang_0.9.2_x64-setup.exe`，实下 8,073,269 字节，sha256 `9FC59558…D49BEBD5` |
| 验签 | ✅ 通过（密码学级） | 用 Node 原生 Ed25519 对下载文件真实验签：`prehashed-BLAKE2b512: true`（minisign `ED` 算法语义），pubKeyId 与 sigKeyId 均 `f2c2fb0f807a00af`，trusted comment 指向正确文件名。**不是 keyId 比对，是真实签名验证** |
| 安装 | ✅ 通过（根因已确证） | 首轮失败：`/S` exit 0 但零变更。**真因不是沙箱**——按坑点 21 把 `$env:TEMP` 指到 D 盘工作区后，NSIS 无法解压自身到 TEMP；用户手动双击时弹出「Error writing temporary file. Make sure your temp folder is valid.」暴露了这一点（我最初「沙箱拦截落地」的诊断是错的）。把 TEMP/TMP 指回 `C:\Users\puj\AppData\Local\Temp` 后 `/S` 安装成功：FileVersion 0.9.0→**0.9.2**、注册表 DisplayVersion **0.9.2**、exe sha256 `8B6D43ED…1E675F8C`、mtime 21:20:22、启动 windowTitle=「灵感大王」正常 |

**关键决策及理由**：
- 用 Node 原生 Ed25519 而非装 minisign 做验签：minisign 底层即 Ed25519 + BLAKE2b-512 预哈希，Node `crypto.verify` 能直接复现，避免为一次验证引入新依赖；且比只比 keyId 强得多——keyId 匹配不能证明签名有效
- Publish 前先完整核验 draft（资产名/数量/latest.json 键/签名长度）：GitHub 剥离非 ASCII 资产名会让 latest.json 生成失败且不易察觉（坑点 14），必须逐项查
- 安装段受阻后不再强行绕：试过 `/S`、`/D=`、cmd 直调、Job 隔离四种方式均无变更；继续尝试属于猜，成本高于收益，如实记录待非沙箱环境验证

**验证方式与结果**：
- `npm run check:version` → OK: version 0.9.2 consistent across 4 locations
- tsc exit 0 / lint exit 0（40 warning 既有遗留）/ **vitest 38 文件 510 passed** / coverage exit 0 / build exit 0 / `cargo check` → `linggandawang v0.9.2` 编译通过
- CSP 精确核验：`connect-src` 10 个具体 source、**无裸通配**；`script-src` 仅 `'self'` + `'wasm-unsafe-eval'`；无 jsdelivr、无 `script-src blob:`
- dist 产物：asyncify=0、总 14.92MB、`dist/ort/ort-wasm-simd-threaded.wasm` 13.60MB 保留
- Release workflow 三平台 job 全 success；CI（main `a433c09`）触发

**遗留问题**：
- ~~OTA 安装段未验证~~ ✅ 已闭环（2026-10-27 21:20）：`/S` 静默安装成功，FileVersion / 注册表 / exe sha256 三方核验均指向 0.9.2，启动 windowTitle=「灵感大王」正常。首轮失败根因是 D 盘 TEMP 让 NSIS 无法解压自身（见坑点 18），非产品缺陷
- 真实 Tauri 安装包内 RAG 端到端仍未验（同上一轮，需实际装 0.9.2 后触发索引）
- 0.9.0 客户端 CSP 缺 huggingface.co（0.9.2 已含），老用户升级后才能用 RAG
