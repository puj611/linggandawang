// src-tauri/src/commands/mod.rs
// Tauri 命令模块：按职责拆分 lib.rs 中的命令

pub mod api_key;
pub mod context;
pub mod image;
pub mod project;
pub mod requirement;
pub mod sidecar;
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

/// 敏感文件校验（共享实现，供 image.rs 和 project.rs 复用）
/// P2 修复：消除 commands/image.rs 和 commands/project.rs 中的重复实现
pub fn is_sensitive_file(name: &str) -> bool {
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
