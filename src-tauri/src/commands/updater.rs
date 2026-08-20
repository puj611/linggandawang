// src-tauri/src/commands/updater.rs
// Task 18 自动更新命令（降级方案）：
// node_modules 缺 @tauri-apps/plugin-updater / plugin-process JS 绑定包且 npm 不可用，
// 前端经 invoke 调用本模块封装 tauri-plugin-updater API。
// pubkey 未配置（tauri.conf.json 中为空占位）或 latest.json 不存在时，
// check 返回 Err，由前端 hook 静默 catch，不影响主流程。

use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone, Debug)]
pub struct UpdateCheckResult {
    /// 是否有可用更新
    pub available: bool,
    /// 新版本号（available 为 true 时非空）
    pub version: Option<String>,
    /// 更新说明（服务端 latest.json 的 notes 字段）
    pub notes: Option<String>,
    /// 当前应用版本（tauri.conf.json 的 version）
    pub current_version: String,
}

/// 检查更新：等价 plugin-updater JS API 的 check()
#[tauri::command]
pub async fn updater_check(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckResult {
            available: true,
            version: Some(update.version.clone()),
            // tauri-plugin-updater 2.x Update 结构的更新说明字段名为 body
            notes: update.body.clone(),
            current_version,
        }),
        Ok(None) => Ok(UpdateCheckResult {
            available: false,
            version: None,
            notes: None,
            current_version,
        }),
        Err(e) => Err(format!("检查更新失败: {e}")),
    }
}

/// 下载并安装更新，安装完成后自动重启应用
/// 等价 plugin-updater JS API 的 update.downloadAndInstall() + plugin-process 的 relaunch()
#[tauri::command]
pub async fn updater_download_and_install(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "没有可用更新".to_string())?;
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    // 安装完成后重启应用生效（restart 返回 never，正常情况下不会走到函数返回）
    app.restart()
}
