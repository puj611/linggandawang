// src-tauri/src/commands/project.rs
// 项目扫描命令

use crate::scanner;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// 全局状态：记录用户最近一次通过 pick_project_folder 选择的目录
pub struct ProjectScanState(pub Mutex<Option<String>>);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PkgJsonPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<std::collections::HashMap<String, String>>,
    #[serde(rename = "devDependencies", skip_serializing_if = "Option::is_none")]
    pub dev_dependencies: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scripts: Option<std::collections::HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScanProjectResult {
    pub root_path: String,
    pub root_files: Vec<String>,
    pub src_dirs: Vec<String>,
    pub root_dirs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_json: Option<PkgJsonPayload>,
}

fn list_dir_names(path: &PathBuf) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        if !name.starts_with('.') && !is_sensitive_file(name) {
                            names.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
    names.sort();
    names
}

fn list_file_names(path: &PathBuf) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_file() {
                    if let Some(name) = entry.file_name().to_str() {
                        if !is_sensitive_file(name) {
                            names.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
    names.sort();
    names
}

fn read_package_json(path: &PathBuf) -> Option<PkgJsonPayload> {
    let content = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    let obj = v.as_object()?;
    let name = obj.get("name").and_then(|x| x.as_str()).map(String::from);
    let version = obj.get("version").and_then(|x| x.as_str()).map(String::from);
    let deps = obj.get("dependencies").and_then(|x| x.as_object()).map(|m| {
        m.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect()
    });
    let dev_deps = obj.get("devDependencies").and_then(|x| x.as_object()).map(|m| {
        m.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect()
    });
    let scripts = obj.get("scripts").and_then(|x| x.as_object()).map(|m| {
        m.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect()
    });
    Some(PkgJsonPayload {
        name,
        version,
        dependencies: deps,
        dev_dependencies: dev_deps,
        scripts,
    })
}

/// 敏感文件校验
fn is_sensitive_file(name: &str) -> bool {
    const SENSITIVE_EXT_PATTERNS: &[&str] = &[
        ".env.local", ".env.production", ".env.development",
        ".env.staging", ".env.test",
        ".pem", ".key", ".pfx", ".p12", ".crt", ".cer",
        ".keystore", ".jks",
        ".kdbx", ".gpg", ".asc", ".ovpn",
        ".sqlite", ".db",
    ];

    const SENSITIVE_NAME_PATTERNS: &[&str] = &[
        ".env",
        "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
        ".npmrc", ".pypirc", ".netrc",
        "credentials", "credentials.json",
        ".aws", ".ssh", ".gitconfig",
        ".htpasswd", "kubeconfig",
        ".docker",
        "secrets.json", "secrets.yaml", "secrets.yml",
        ".bash_history", ".zsh_history", ".psql_history",
        "docker-compose.yml", "docker-compose.yaml",
        ".yarnrc", ".yarnrc.yml",
    ];

    let lower = name.to_ascii_lowercase();
    if SENSITIVE_EXT_PATTERNS.iter().any(|p| lower.ends_with(p)) {
        return true;
    }
    let segments: std::collections::HashSet<&str> = lower.split(|c| c == '/' || c == '\\').collect();
    SENSITIVE_NAME_PATTERNS.iter().any(|p| segments.contains(*p))
}

#[tauri::command]
pub async fn pick_project_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProjectScanState>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog().file().pick_folder(move |path| {
        let result = path.map(|p| p.to_string());
        let _ = tx.send(result);
    });
    match rx.await {
        Ok(p) => {
            if let Some(ref path) = p {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(path.clone());
                }
            }
            Ok(p)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn scan_project(
    path: String,
    state: tauri::State<'_, ProjectScanState>,
) -> Result<ScanProjectResult, String> {
    let allowed = state
        .0
        .lock()
        .map(|guard| guard.as_ref().map(|s| s.to_string()))
        .ok()
        .flatten();

    match allowed {
        Some(allowed_path) => {
            let req_canonical = PathBuf::from(&path)
                .canonicalize()
                .map_err(|e| format!("路径解析失败: {}", e))?;
            let allowed_canonical = PathBuf::from(&allowed_path)
                .canonicalize()
                .map_err(|e| format!("已选路径解析失败: {}", e))?;
            if req_canonical != allowed_canonical {
                return Err("无权限扫描此目录（请先通过文件夹选择器选择目录）".to_string());
            }
        }
        None => {
            return Err("请先通过文件夹选择器选择要扫描的项目目录".to_string());
        }
    }

    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    if !root.is_dir() {
        return Err(format!("不是目录: {}", path));
    }

    let root_files = list_file_names(&root);
    let root_dirs = list_dir_names(&root);

    let src_path = root.join("src");
    let src_dirs = if src_path.exists() && src_path.is_dir() {
        list_dir_names(&src_path)
    } else {
        Vec::new()
    };

    let pkg_path = root.join("package.json");
    let package_json = if pkg_path.exists() {
        read_package_json(&pkg_path)
    } else {
        None
    };

    Ok(ScanProjectResult {
        root_path: path,
        root_files,
        src_dirs,
        root_dirs,
        package_json,
    })
}

#[tauri::command]
pub fn full_scan_project(
    path: String,
    max_depth: Option<usize>,
    state: tauri::State<'_, ProjectScanState>,
) -> Result<scanner::FullScanResult, String> {
    let allowed = state
        .0
        .lock()
        .map(|guard| guard.as_ref().map(|s| s.to_string()))
        .ok()
        .flatten();

    match allowed {
        Some(allowed_path) => {
            let req_canonical = PathBuf::from(&path)
                .canonicalize()
                .map_err(|e| format!("路径解析失败: {}", e))?;
            let allowed_canonical = PathBuf::from(&allowed_path)
                .canonicalize()
                .map_err(|e| format!("已选路径解析失败: {}", e))?;
            if req_canonical != allowed_canonical {
                return Err("无权限扫描此目录（请先通过文件夹选择器选择目录）".to_string());
            }
        }
        None => {
            return Err("请先通过文件夹选择器选择要扫描的项目目录".to_string());
        }
    }

    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    if !root.is_dir() {
        return Err(format!("不是目录: {}", path));
    }

    let depth = max_depth.unwrap_or(6);
    Ok(scanner::full_scan(&root, depth))
}

#[tauri::command]
pub fn scan_file_tree_cmd(
    path: String,
    max_depth: Option<usize>,
) -> Result<scanner::FileTree, String> {
    let root = PathBuf::from(&path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("无效目录: {}", path));
    }
    Ok(scanner::scan_file_tree(&root, max_depth.unwrap_or(6)))
}

#[tauri::command]
pub fn git_status_cmd(path: String) -> Result<scanner::GitStatus, String> {
    let root = PathBuf::from(&path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("无效目录: {}", path));
    }
    Ok(scanner::parse_git_status(&root))
}

#[tauri::command]
pub fn analyze_deps_cmd(path: String) -> Result<scanner::DependencyGraph, String> {
    let root = PathBuf::from(&path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("无效目录: {}", path));
    }
    Ok(scanner::analyze_dependencies(&root))
}
