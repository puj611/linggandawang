// src-tauri/src/commands/mod.rs
// Tauri 命令模块：按职责拆分 lib.rs 中的命令

pub mod api_key;
pub mod context;
pub mod image;
pub mod project;
pub mod requirement;
pub mod window;

use std::path::PathBuf;
use std::fs;
use tauri::Manager;

/// 应用配置目录（跨平台）
pub fn app_config_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".linggandawang")
    });
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}
