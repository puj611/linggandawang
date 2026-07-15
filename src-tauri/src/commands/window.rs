// src-tauri/src/commands/window.rs
// 窗口位置持久化命令

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::app_config_dir;

fn window_position_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("window-position.json")
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowPositionPayload {
    pub x: f64,
    pub y: f64,
    pub screen: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowPositionResult {
    pub x: f64,
    pub y: f64,
    pub screen: Option<String>,
}

#[tauri::command]
pub fn save_window_position(
    app: tauri::AppHandle,
    payload: WindowPositionPayload,
) -> Result<(), String> {
    let path = window_position_path(&app);
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_window_position(app: tauri::AppHandle) -> Result<Option<WindowPositionResult>, String> {
    let path = window_position_path(&app);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let payload: WindowPositionPayload =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(WindowPositionResult {
        x: payload.x,
        y: payload.y,
        screen: Some(payload.screen),
    }))
}
