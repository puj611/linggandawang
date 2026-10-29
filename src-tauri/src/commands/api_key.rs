// src-tauri/src/commands/api_key.rs
// API Key 安全存储命令（keyring / Windows Credential Manager）

const KEYRING_SERVICE: &str = "linggandawang";
// 2026-10-29 审查 M3：此前本文件与 llm_proxy.rs 各有一份且不一致（缺 local）。
// 统一引用 llm_proxy 的单一来源，避免新增 provider 时漏改一处。
use super::llm_proxy::ALLOWED_PROVIDERS;

fn validate_provider(provider: &str) -> Result<(), String> {
    if !ALLOWED_PROVIDERS.contains(&provider) {
        return Err(format!("不支持的服务商: {}", provider));
    }
    Ok(())
}

fn validate_api_key(api_key: &str) -> Result<(), String> {
    if api_key.is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    if api_key.len() > 1024 {
        return Err("API Key 长度异常（超过 1024 字节）".to_string());
    }
    if !api_key.chars().all(|c| c.is_ascii_graphic() || c == ' ') {
        return Err("API Key 含非法字符（仅允许可见 ASCII）".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    validate_provider(&provider)?;
    validate_api_key(&api_key)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|_| "密钥存储服务不可用".to_string())?;
    entry.set_password(&api_key)
        .map_err(|_| "保存 API Key 失败".to_string())
}

/// 只查密钥是否存在，不返回明文（2026-10-29 审查 H1 修复）。
/// 渲染进程只需要知道「是否已配置」来决定 UI 与降级路径，不需要明文。
#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    validate_provider(&provider)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|_| "密钥存储服务不可用".to_string())?;
    Ok(entry.get_password().is_ok())
}

/// @deprecated 安全（2026-10-29 审查 H1）：返回明文给渲染进程，与
/// llm_proxy 的「key 由 Rust 注入」设计冲突。仅为浏览器模式降级保留。
/// 生产路径应使用 has_api_key。
#[tauri::command]
pub fn load_api_key(provider: String) -> Result<Option<String>, String> {
    validate_provider(&provider)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|_| "密钥存储服务不可用".to_string())?;
    match entry.get_password() {
        Ok(pwd) => Ok(Some(pwd)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("读取 API Key 失败".to_string()),
    }
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    validate_provider(&provider)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|_| "密钥存储服务不可用".to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("删除 API Key 失败".to_string()),
    }
}
