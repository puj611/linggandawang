// src-tauri/src/commands/api_key.rs
// API Key 安全存储命令（keyring / Windows Credential Manager）

const KEYRING_SERVICE: &str = "linggandawang";
const ALLOWED_PROVIDERS: &[&str] = &["openai", "deepseek", "tongyi", "custom"];

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
