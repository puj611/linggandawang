// src-tauri/src/commands/llm_proxy.rs
// LLM 请求 Rust 代理：密钥代理注入 + SSRF DNS 校验
//
// 安全目标：
// 1. 前端不再持有明文 API Key —— Rust 从 keyring 读取并注入 Authorization header
// 2. SSRF 归一化补全 —— Rust 侧做 DNS 解析，校验解析结果不落内网（防 DNS 重绑定）
//    这是前端 JS 轻量校验无法覆盖的部分（前端开源可直接绕过）
// 3. 浏览器模式降级为前端直连（见 openai-adapter.ts）

use serde::Deserialize;
use std::net::IpAddr;

const KEYRING_SERVICE: &str = "linggandawang";
/// 服务商白名单（单一来源）：api_key.rs 也引用本常量，避免两处漂移
pub const ALLOWED_PROVIDERS: &[&str] = &["openai", "deepseek", "tongyi", "custom", "local"];

#[derive(Deserialize, serde::Serialize)]
pub struct ProxyMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct LlmProxyChatRequest {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub messages: Vec<ProxyMessage>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    /// 业务超时（秒）：由前端按调用场景传入（如意图分析 8s、图片拆解 20s）。
    /// 未传时回退到 120s 上限。用于服务端真正中断 reqwest，实现副作用可回收的取消。
    pub timeout_secs: Option<u64>,
}

/// 从 keyring 读取服务商 API Key；local 模型无需 key。
/// 出错时返回可读错误；未配置 key 返回空串（由调用方决定语义）。
fn read_key(provider: &str) -> Result<String, String> {
    if provider == "local" {
        return Ok(String::new());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|_| "密钥存储服务不可用".to_string())?;
    match entry.get_password() {
        Ok(pwd) => Ok(pwd),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(_) => Err("读取 API Key 失败".to_string()),
    }
}

/// 判断 IP 是否属于内网/保留地址（SSRF 防护核心）。
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                // 运营商级 NAT 100.64.0.0/10
                || (v4.octets()[0] == 100 && (64..=127).contains(&v4.octets()[1]))
                // IETF 协议分配 192.0.0.0/24
                || (v4.octets()[0] == 192 && v4.octets()[1] == 0)
                // 用于测试的保留段 198.18.0.0/15
                || (v4.octets()[0] == 198 && (18..=19).contains(&v4.octets()[1]))
                // 文档示例 203.0.113.0/24
                || (v4.octets()[0] == 203 && v4.octets()[1] == 0 && v4.octets()[2] == 113)
        }
        IpAddr::V6(v6) => {
            // 审查 P1 修复：IPv4-mapped（::ffff:a.b.c.d）必须还原成 IPv4 再判——
            // Rust std 的 is_loopback() 只认 ::1，::ffff:127.0.0.1 会漏过导致 SSRF 绕过
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(v4));
            }
            // NAT64 段 64:ff9b::/96 可映射任意 IPv4（含内网），直接拒绝
            if v6.segments()[0] == 0x64 && v6.segments()[1] == 0xff9b {
                return true;
            }
            v6.is_loopback()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_unspecified()
        }
    }
}

/// SSRF 防护：协议白名单 + DNS 解析校验（防 DNS 重绑定）。
/// - 仅允许 HTTPS（localhost / 127.0.0.1 本地开发除外 HTTP）
/// - 除本地字面主机外，解析域名并校验所有结果 IP 不落内网
async fn validate_ssrf(base_url: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(base_url).map_err(|_| "API 地址格式无效".to_string())?;

    match url.scheme() {
        "https" => {}
        "http" => {
            let h = url.host_str().unwrap_or("");
            if h != "localhost" && h != "127.0.0.1" {
                return Err("仅支持 HTTPS 地址（本地开发除外），HTTP 会导致密钥明文传输".to_string());
            }
        }
        _ => return Err("不支持的协议，仅支持 https:".to_string()),
    }

    let host = url.host_str().unwrap_or("").to_lowercase();
    // 本地开发字面主机直接放行（其解析结果本就为内网回环）
    if host == "localhost" || host == "127.0.0.1" || host == "::1" {
        return Ok(());
    }

    // 解析域名并校验：任一解析结果落入内网即拒绝（覆盖 DNS 重绑定 SSRF）
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| "DNS 解析失败".to_string())?;
    for addr in addrs {
        if is_private_ip(addr.ip()) {
            return Err("不允许解析到内网地址，存在安全风险".to_string());
        }
    }
    Ok(())
}

/// 脱敏错误文本，避免 LLM 端点回显的 key 泄露到日志/UI
/// 审查 P7 修复：除 Bearer 前缀外，裸 key（sk-xxx 等）形态也一并遮蔽。
/// 手工扫描实现（不引入 regex 依赖）：匹配 sk- 开头 + ≥20 位字母数字。
fn sanitize(text: &str) -> String {
    let without_bearer = text.replace("Bearer ", "");
    let bytes = without_bearer.as_bytes();
    let mut out = String::with_capacity(without_bearer.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b's' && i + 1 < bytes.len() && bytes[i + 1] == b'k' && i + 2 < bytes.len() && bytes[i + 2] == b'-' {
            // 统计 sk- 后连续字母数字长度
            let mut j = i + 3;
            while j < bytes.len() && (bytes[j] as char).is_ascii_alphanumeric() {
                j += 1;
            }
            if j - (i + 3) >= 20 {
                out.push_str("sk-***");
                i = j;
                continue;
            }
        }
        out.push(without_bearer[i..].chars().next().unwrap());
        i += without_bearer[i..].chars().next().unwrap().len_utf8();
    }
    out
}

#[tauri::command]
pub async fn llm_proxy_chat(req: LlmProxyChatRequest) -> Result<serde_json::Value, String> {
    if !ALLOWED_PROVIDERS.contains(&req.provider.as_str()) {
        return Err(format!("不支持的服务商: {}", req.provider));
    }

    // 密钥代理注入：Rust 从 keyring 读取，前端不接触明文 key
    let api_key = read_key(&req.provider)?;

    // SSRF：协议 + DNS 解析校验
    validate_ssrf(&req.base_url).await?;

    let url = format!("{}/chat/completions", req.base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "temperature": req.temperature.unwrap_or(0.7),
        "stream": false,
    });
    if let Some(mt) = req.max_tokens {
        body["max_tokens"] = serde_json::json!(mt);
    }

    let client = reqwest::Client::builder()
        // 客户端级超时下限 5s；业务超时由 tokio::time::timeout 落地
        .timeout(std::time::Duration::from_secs(req.timeout_secs.unwrap_or(120).max(5)))
        .build()
        .map_err(|_| "HTTP 客户端初始化失败".to_string())?;

    let mut req_builder = client
        .post(&url)
        .header("Content-Type", "application/json");
    if !api_key.is_empty() {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    // 业务超时在此落地：届时中断 reqwest，错误可回收，不占住 tokio worker 120s
    let timeout_secs = req.timeout_secs.unwrap_or(120).max(5);
    let resp = match tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        req_builder.json(&body).send(),
    )
    .await
    {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return Err(format!("请求 LLM 失败: {}", e)),
        Err(_) => return Err(format!("LLM 请求超时（{}秒）", timeout_secs)),
    };
    let status = resp.status();
    let text = resp.text().await.map_err(|_| "读取 LLM 响应失败".to_string())?;
    if !status.is_success() {
        return Err(format!(
            "LLM 请求失败 ({}): {}",
            status.as_u16(),
            sanitize(&text)
        ));
    }
    serde_json::from_str(&text).map_err(|_| "LLM 响应解析失败".to_string())
}

/// 连接测试：Rust 读 key + SSRF 校验 + GET /models（供前端 testConnection 使用）
#[tauri::command]
pub async fn llm_proxy_test(provider: String, base_url: String) -> Result<bool, String> {
    let api_key = read_key(&provider)?;
    validate_ssrf(&base_url).await?;
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| "HTTP 客户端初始化失败".to_string())?;
    let mut req_builder = client.get(&url);
    if !api_key.is_empty() {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
    }
    Ok(req_builder.send().await.map(|r| r.status().is_success()).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn private_ipv4_rejected() {
        let cases = [
            "127.0.0.1",   // 回环
            "10.0.0.1",    // A 类私有
            "172.16.0.1",  // B 类私有
            "192.168.1.1", // C 类私有
            "169.254.1.1", // 链路本地（云元数据端点）
            "0.0.0.0",     // 本网络
            "100.64.0.1",  // CGNAT
            "192.0.0.1",   // IETF
            "198.18.0.1",  // 测试
            "203.0.113.1", // 文档示例
        ];
        for c in cases {
            let ip: IpAddr = c.parse().unwrap();
            assert!(is_private_ip(ip), "应拒绝内网/保留地址: {}", c);
        }
    }

    #[test]
    fn public_ipv4_allowed() {
        let cases = [
            "8.8.8.8",      // Google DNS
            "1.1.1.1",      // Cloudflare
            "140.82.112.3", // github.com
        ];
        for c in cases {
            let ip: IpAddr = c.parse().unwrap();
            assert!(!is_private_ip(ip), "应放行公网地址: {}", c);
        }
    }

    #[test]
    fn private_ipv6_rejected() {
        let cases = [
            "::1",            // 回环
            "fc00::1",        // 唯一本地
            "fd12:3456::1",   // 唯一本地
            "fe80::1",        // 链路本地
            "::",             // unspecified
        ];
        for c in cases {
            let ip: IpAddr = c.parse().unwrap();
            assert!(is_private_ip(ip), "应拒绝内网 IPv6: {}", c);
        }
    }

    #[test]
    fn public_ipv6_allowed() {
        let ip = Ipv6Addr::new(0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111); // 1.1.1.1 IPv6
        assert!(!is_private_ip(IpAddr::V6(ip)));
    }

    #[test]
    fn ipv4_mapped_ipv6_rejected() {
        // 审查 P1：IPv4-mapped IPv6 曾绕过 is_private_ip（is_loopback 只认 ::1）
        let cases = [
            "::ffff:127.0.0.1",  // 回环映射
            "::ffff:10.0.0.1",   // A 类私有映射
            "::ffff:192.168.1.1", // C 类私有映射
            "::ffff:169.254.1.1", // 链路本地映射（云元数据）
        ];
        for c in cases {
            let ip: IpAddr = c.parse().unwrap();
            assert!(is_private_ip(ip), "应拒绝 IPv4-mapped 内网地址: {}", c);
        }
        // 公网映射仍放行
        let ip: IpAddr = "::ffff:8.8.8.8".parse().unwrap();
        assert!(!is_private_ip(ip));
    }

    #[test]
    fn nat64_rejected() {
        // 审查 P1：NAT64 64:ff9b::/96 可映射任意 IPv4（含内网），整体拒绝
        let ip: IpAddr = "64:ff9b::7f00:1".parse().unwrap(); // 127.0.0.1
        assert!(is_private_ip(ip), "应拒绝 NAT64 映射的回环地址");
        let ip2: IpAddr = "64:ff9b::a00:1".parse().unwrap(); // 10.0.0.1
        assert!(is_private_ip(ip2), "应拒绝 NAT64 映射的私有地址");
    }

    #[test]
    fn sanitize_masks_bare_and_bearer_keys() {
        // 审查 P7：Bearer 前缀与裸 sk- key 均须遮蔽
        let key = "sk-abcdefghijklmnopqrstuvwxyz123456";
        assert_eq!(
            sanitize(&format!("invalid api key: {}", key)),
            "invalid api key: sk-***"
        );
        assert_eq!(sanitize("Bearer abc123"), "abc123");
        // 短 sk-（非 key 形态）不误伤
        assert_eq!(sanitize("task-scheduler-xx sk-short"), "task-scheduler-xx sk-short");
    }

    #[test]
    fn ipv4_octets_helpers() {
        // 边界：100.127.255.255 是 CGNAT 上界，100.128.0.0 不是
        let cgnat_upper = Ipv4Addr::new(100, 127, 255, 255);
        assert!(is_private_ip(IpAddr::V4(cgnat_upper)));
        let not_cgnat = Ipv4Addr::new(100, 128, 0, 0);
        assert!(!is_private_ip(IpAddr::V4(not_cgnat)));
    }
}