use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

fn app_config_dir(app: &tauri::AppHandle) -> PathBuf {
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

fn context_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("context.json")
}

fn user_bank_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("user-bank.yaml")
}

fn window_position_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("window-position.json")
}

fn archive_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app_config_dir(app).join("archive");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextPayload {
    pub content: String,
}

#[tauri::command]
fn save_context(app: tauri::AppHandle, payload: ContextPayload) -> Result<(), String> {
    let path = context_path(&app);
    fs::write(&path, payload.content).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_context(app: tauri::AppHandle) -> Result<String, String> {
    let path = context_path(&app);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn archive_context(app: tauri::AppHandle) -> Result<(), String> {
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

// =============== user-preferences.json ===============

fn user_preferences_path(app: &tauri::AppHandle) -> PathBuf {
    app_config_dir(app).join("user-preferences.json")
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserPreferencePayload {
    pub key: String,
    pub value: String,
}

#[tauri::command]
fn save_user_preference(app: tauri::AppHandle, payload: UserPreferencePayload) -> Result<(), String> {
    let mut prefs = load_preferences(&app)?;
    prefs.insert(payload.key, serde_json::Value::String(payload.value));
    save_preferences(&app, &prefs)
}

#[tauri::command]
fn load_user_preference(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let prefs = load_preferences(&app)?;
    match prefs.get(&key) {
        Some(serde_json::Value::String(s)) => Ok(Some(s.clone())),
        _ => Ok(None),
    }
}

// =============== API Key 安全存储（keyring / Windows Credential Manager）===============

const KEYRING_SERVICE: &str = "linggandawang";

// 允许的 LLM 服务商标识
const ALLOWED_PROVIDERS: &[&str] = &["openai", "deepseek", "tongyi", "custom"];

fn validate_provider(provider: &str) -> Result<(), String> {
    if !ALLOWED_PROVIDERS.contains(&provider) {
        return Err(format!("不支持的服务商: {}", provider));
    }
    Ok(())
}

#[tauri::command]
fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    validate_provider(&provider)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|_| "密钥存储服务不可用".to_string())?;
    entry.set_password(&api_key)
        .map_err(|_| "保存 API Key 失败".to_string())
}

#[tauri::command]
fn load_api_key(provider: String) -> Result<Option<String>, String> {
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
fn delete_api_key(provider: String) -> Result<(), String> {
    validate_provider(&provider)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|_| "密钥存储服务不可用".to_string())?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("删除 API Key 失败".to_string()),
    }
}

// =============== user-bank.yaml ===============

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserBankPayload {
    pub content: String,
}

#[tauri::command]
fn load_user_bank(app: tauri::AppHandle) -> Result<String, String> {
    let path = user_bank_path(&app);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_user_bank(app: tauri::AppHandle, payload: UserBankPayload) -> Result<(), String> {
    let path = user_bank_path(&app);
    fs::write(&path, payload.content).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_user_bank(app: tauri::AppHandle) -> Result<(), String> {
    let path = user_bank_path(&app);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// =============== window-position.json ===============

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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImageDataResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
}

// 读取本地图片文件为 data URL。
// 用于支持从资源管理器拖入图片到悬浮窗。
// 安全限制：仅允许读取用户通过文件选择器选定的目录下的图片，或临时文件目录。
#[tauri::command]
fn read_image_file(path: String, app: tauri::AppHandle) -> Result<ImageDataResult, String> {
    use std::io::Read;

    let pb = PathBuf::from(&path);
    if !pb.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    // 安全校验：拒绝读取系统敏感目录
    let canonical = pb.canonicalize().map_err(|e| format!("路径解析失败: {}", e))?;
    let path_str = canonical.to_string_lossy().to_lowercase();

    // 拒绝系统关键目录
    const BLOCKED_PATHS: &[&str] = &[
        "windows\\system32",
        "bootmgr",
        "\\etc\\",
        "programdata\\microsoft\\crypto",
    ];
    for blocked in BLOCKED_PATHS {
        if path_str.contains(blocked) {
            return Err("无权限读取此路径".to_string());
        }
    }

    // 限制文件大小（10MB），防止读取超大文件导致内存溢出
    const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err("文件过大（超过10MB限制）".to_string());
    }

    let ext = pb
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => return Err(format!("不支持的图片格式: {}", ext)),
    };

    let mut file = fs::File::open(&pb).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let bytes = buf.len();

    // 简单读取宽高（PNG/JPEG/GIF/WebP/BMP），失败就回退为 0
    let (width, height) = read_image_dimensions(&ext, &buf);

    let b64 = base64_encode(&buf);
    let data_url = format!("data:{};base64,{}", mime, b64);

    Ok(ImageDataResult {
        data_url,
        width,
        height,
        bytes,
    })
}

fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 3 <= data.len() {
        let b0 = data[i];
        let b1 = data[i + 1];
        let b2 = data[i + 2];
        out.push(ALPHABET[(b0 >> 2) as usize] as char);
        out.push(ALPHABET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(ALPHABET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        out.push(ALPHABET[(b2 & 0x3f) as usize] as char);
        i += 3;
    }
    let rem = data.len() - i;
    if rem == 1 {
        let b0 = data[i];
        out.push(ALPHABET[(b0 >> 2) as usize] as char);
        out.push(ALPHABET[((b0 & 0x03) << 4) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let b0 = data[i];
        let b1 = data[i + 1];
        out.push(ALPHABET[(b0 >> 2) as usize] as char);
        out.push(ALPHABET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(ALPHABET[((b1 & 0x0f) << 2) as usize] as char);
        out.push('=');
    }
    out
}

fn read_image_dimensions(ext: &str, buf: &[u8]) -> (u32, u32) {
    match ext {
        "png" => {
            // PNG IHDR: bytes 16..24
            if buf.len() >= 24 {
                let w = u32::from_be_bytes([buf[16], buf[17], buf[18], buf[19]]);
                let h = u32::from_be_bytes([buf[20], buf[21], buf[22], buf[23]]);
                (w, h)
            } else {
                (0, 0)
            }
        }
        "jpg" | "jpeg" => read_jpeg_dimensions(buf),
        "gif" => {
            if buf.len() >= 10 {
                let w = u16::from_le_bytes([buf[6], buf[7]]) as u32;
                let h = u16::from_le_bytes([buf[8], buf[9]]) as u32;
                (w, h)
            } else {
                (0, 0)
            }
        }
        "bmp" => {
            if buf.len() >= 26 {
                let w = u32::from_le_bytes([buf[18], buf[19], buf[20], buf[21]]);
                let h = u32::from_le_bytes([buf[22], buf[23], buf[24], buf[25]]);
                (w, h)
            } else {
                (0, 0)
            }
        }
        "webp" => read_webp_dimensions(buf),
        _ => (0, 0),
    }
}

fn read_jpeg_dimensions(buf: &[u8]) -> (u32, u32) {
    let mut i = 2;
    while i + 9 < buf.len() {
        if buf[i] != 0xFF {
            return (0, 0);
        }
        let marker = buf[i + 1];
        // SOF0..SOF15 except DHT(0xC4), DNL(0xCC), JPG(0xC8)
        if (0xC0..=0xCF).contains(&marker)
            && marker != 0xC4
            && marker != 0xC8
            && marker != 0xCC
        {
            let h = u16::from_be_bytes([buf[i + 5], buf[i + 6]]) as u32;
            let w = u16::from_be_bytes([buf[i + 7], buf[i + 8]]) as u32;
            return (w, h);
        }
        let seg_len = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
        i += 2 + seg_len;
    }
    (0, 0)
}

fn read_webp_dimensions(buf: &[u8]) -> (u32, u32) {
    // RIFF....WEBP
    if buf.len() < 30 || &buf[0..4] != b"RIFF" || &buf[8..12] != b"WEBP" {
        return (0, 0);
    }
    let fourcc = &buf[12..16];
    match fourcc {
        b"VP8 " => {
            let w = u16::from_le_bytes([buf[26], buf[27]]) as u32 & 0x3FFF;
            let h = u16::from_le_bytes([buf[28], buf[29]]) as u32 & 0x3FFF;
            (w, h)
        }
        b"VP8L" => {
            let b0 = buf[21] as u32;
            let b1 = buf[22] as u32;
            let b2 = buf[23] as u32;
            let b3 = buf[24] as u32;
            let w = 1 + (((b1 & 0x3F) << 8) | b0);
            let h = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
            (w, h)
        }
        b"VP8X" => {
            if buf.len() >= 30 {
                let w = 1 + (u32::from_le_bytes([buf[24], buf[25], buf[26], 0]) & 0x00FFFFFF);
                let h = 1 + (u32::from_le_bytes([buf[27], buf[28], buf[29], 0]) & 0x00FFFFFF);
                (w, h)
            } else {
                (0, 0)
            }
        }
        _ => (0, 0),
    }
}

#[tauri::command]
fn save_window_position(
    app: tauri::AppHandle,
    payload: WindowPositionPayload,
) -> Result<(), String> {
    let path = window_position_path(&app);
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_window_position(app: tauri::AppHandle) -> Result<Option<WindowPositionResult>, String> {
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

#[derive(Serialize, Clone, Debug)]
struct ShortcutEvent {
    visible: bool,
}

// =============== 项目扫描（pick_project_folder + scan_project）===============

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

#[tauri::command]
fn pick_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });
    match rx.recv() {
        Ok(Some(p)) => Ok(Some(p)),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// 敏感文件/目录黑名单 - 扫描项目时跳过这些文件
const SENSITIVE_PATTERNS: &[&str] = &[
    ".env", ".env.local", ".env.production", ".env.development",
    ".env.staging", ".env.test",
    "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    ".pem", ".key", ".pfx", ".p12", ".crt", ".cer",
    ".keystore", ".jks",
    ".npmrc", ".pypirc", ".netrc",
    "credentials", "credentials.json",
    ".aws", ".ssh", ".gitconfig",
    ".htpasswd", "kubeconfig",
    ".docker", "secrets.json", "secrets.yaml", "secrets.yml",
    ".bash_history", ".zsh_history", ".psql_history",
    ".kdbx", ".gpg", ".asc", ".ovpn",
    "docker-compose.yml", "docker-compose.yaml",
    ".yarnrc", ".yarnrc.yml",
    ".sqlite", ".db",
];

fn is_sensitive_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SENSITIVE_PATTERNS.iter().any(|p| lower.contains(p))
}

#[tauri::command]
fn scan_project(path: String) -> Result<ScanProjectResult, String> {
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

fn sqlite_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_prompt_history",
            sql: include_str!("../migrations/0001_create_prompt_history.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_user_preferences",
            sql: include_str!("../migrations/0002_create_user_preferences.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_question_bank_cache",
            sql: include_str!("../migrations/0003_create_question_bank_cache.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:linggandawang.db", sqlite_migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            save_context,
            load_context,
            archive_context,
            load_user_bank,
            save_user_bank,
            clear_user_bank,
            save_window_position,
            load_window_position,
            read_image_file,
            save_user_preference,
            load_user_preference,
            pick_project_folder,
            scan_project,
            save_api_key,
            load_api_key,
            delete_api_key,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 注册全局热键 Alt+Shift+Space 唤起/隐藏主窗口
            // 避开 Windows 系统占用的 Alt+Space
            const HOTKEY: &str = "Alt+Shift+Space";
            let app_handle = app.handle().clone();
            let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([HOTKEY])?
                .with_handler(move |app, shortcut, _event| {
                    if shortcut.to_string() == HOTKEY {
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(true);
                            if visible {
                                let _ = window.hide();
                                let _ = app.emit(
                                    "global-shortcut-triggered",
                                    ShortcutEvent { visible: false },
                                );
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = app.emit(
                                    "global-shortcut-triggered",
                                    ShortcutEvent { visible: true },
                                );
                            }
                        }
                    }
                })
                .build();
            app_handle.plugin(shortcut_plugin)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
