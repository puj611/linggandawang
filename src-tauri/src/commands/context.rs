// src-tauri/src/commands/context.rs
// 上下文 + 用户银行 + 用户偏好命令

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::app_config_dir;

fn context_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("context.json")
}

fn user_bank_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("user-bank.yaml")
}

fn user_preferences_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("user-preferences.json")
}

fn archive_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app_config_dir(app).join("archive");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

// =============== Context ===============

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextPayload {
    pub content: String,
}

#[tauri::command]
pub fn save_context(app: tauri::AppHandle, payload: ContextPayload) -> Result<(), String> {
    let path = context_path(&app);
    fs::write(&path, payload.content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_context(app: tauri::AppHandle) -> Result<String, String> {
    let path = context_path(&app);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn archive_context(app: tauri::AppHandle) -> Result<(), String> {
    let path = context_path(&app);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let ts = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let archive_path = archive_dir(&app).join(format!("context-{}.json", ts));
    fs::write(&archive_path, content).map_err(|e| e.to_string())?;
    fs::remove_file(&path).map_err(|e| e.to_string())
}

// =============== User Bank ===============

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserBankPayload {
    pub content: String,
}

#[tauri::command]
pub fn load_user_bank(app: tauri::AppHandle) -> Result<String, String> {
    let path = user_bank_path(&app);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_user_bank(app: tauri::AppHandle, payload: UserBankPayload) -> Result<(), String> {
    let path = user_bank_path(&app);
    fs::write(&path, payload.content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_user_bank(app: tauri::AppHandle) -> Result<(), String> {
    let path = user_bank_path(&app);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// =============== User Preferences ===============

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserPreferencePayload {
    pub key: String,
    pub value: String,
}

fn load_preferences(app: &tauri::AppHandle) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let path = user_preferences_path(app);
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let obj: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    match obj.as_object() {
        Some(map) => Ok(map.clone()),
        None => Ok(serde_json::Map::new()),
    }
}

fn save_preferences(app: &tauri::AppHandle, prefs: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let path = user_preferences_path(app);
    let content = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_user_preference(app: tauri::AppHandle, payload: UserPreferencePayload) -> Result<(), String> {
    let mut prefs = load_preferences(&app)?;
    prefs.insert(payload.key, serde_json::Value::String(payload.value));
    save_preferences(&app, &prefs)
}

#[tauri::command]
pub fn load_user_preference(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let prefs = load_preferences(&app)?;
    match prefs.get(&key) {
        Some(serde_json::Value::String(s)) => Ok(Some(s.clone())),
        _ => Ok(None),
    }
}
