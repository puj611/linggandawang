// src-tauri/src/commands/image.rs
// 图片文件读取命令（含安全检查）

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;

use super::is_sensitive_file;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImageDataResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
}

/// 白名单校验：路径是否位于用户主目录或临时目录下
fn is_in_user_scope(canonical: &PathBuf) -> bool {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from);
    let temp = std::env::var("TEMP")
        .or_else(|_| std::env::var("TMP"))
        .ok()
        .map(PathBuf::from);

    if let Some(home) = home {
        if let Ok(home_canon) = home.canonicalize() {
            if canonical.starts_with(&home_canon) {
                return true;
            }
        }
    }
    if let Some(temp) = temp {
        if let Ok(temp_canon) = temp.canonicalize() {
            if canonical.starts_with(&temp_canon) {
                return true;
            }
        }
    }
    false
}

/// 读取本地图片文件为 data URL
#[tauri::command]
pub fn read_image_file(path: String) -> Result<ImageDataResult, String> {
    let pb = PathBuf::from(&path);
    if !pb.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let canonical = pb.canonicalize().map_err(|e| format!("路径解析失败: {}", e))?;
    let path_str = canonical.to_string_lossy().to_lowercase();

    // 白名单校验
    if !is_in_user_scope(&canonical) {
        const BLOCKED_PATHS: &[&str] = &[
            "windows\\system32",
            "windows\\system",
            "windows\\",
            "bootmgr",
            "\\etc\\",
            "programdata\\microsoft\\crypto",
            "program files\\",
            "program files (x86)\\",
            "\\$recycle.bin",
            "config\\systemprofile",
        ];
        for blocked in BLOCKED_PATHS {
            if path_str.contains(blocked) {
                return Err("无权限读取此路径".to_string());
            }
        }
    }

    // 敏感文件校验
    let file_name = pb.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if is_sensitive_file(file_name) {
        return Err("无权限读取敏感文件".to_string());
    }

    // 文件大小限制（10MB）
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
        _ => return Err(format!("不支持的图片格式: {}（仅支持 png/jpg/gif/webp/bmp）", ext)),
    };

    let mut file = fs::File::open(&pb).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let bytes = buf.len();

    let (width, height) = read_image_dimensions(&ext, &buf);

    // P0 修复：使用标准 base64 crate 替代手写实现，避免正确性风险
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    let data_url = format!("data:{};base64,{}", mime, b64);

    Ok(ImageDataResult {
        data_url,
        width,
        height,
        bytes,
    })
}

fn read_image_dimensions(ext: &str, buf: &[u8]) -> (u32, u32) {
    match ext {
        "png" => {
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
        if (0xC0..=0xCF).contains(&marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC {
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
