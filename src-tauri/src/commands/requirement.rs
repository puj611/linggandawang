// src-tauri/src/commands/requirement.rs
// 需求同步器持久化命令

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::app_config_dir;

fn requirements_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("requirements.json")
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RequirementsPayload {
    pub requirements: Vec<serde_json::Value>,
}

#[tauri::command]
pub fn load_requirements(app: tauri::AppHandle) -> Result<RequirementsPayload, String> {
    let path = requirements_path(&app);
    if !path.exists() {
        return Ok(RequirementsPayload { requirements: Vec::new() });
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let payload: RequirementsPayload = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(payload)
}

#[tauri::command]
pub fn save_requirements(app: tauri::AppHandle, requirements: Vec<serde_json::Value>) -> Result<(), String> {
    let path = requirements_path(&app);
    let payload = RequirementsPayload { requirements };
    let content = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}
