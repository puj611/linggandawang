// src-tauri/src/commands/sidecar.rs
// llama-server sidecar 进程管理
// 负责启动、停止、健康检查本地 llama-server

use std::sync::Mutex;
use tauri::{Manager, State};
use serde::{Deserialize, Serialize};

/// 本地 LLM 服务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalLLMStatus {
    pub running: bool,
    pub port: u16,
    pub pid: Option<u32>,
    pub model_path: Option<String>,
    pub error: Option<String>,
}

/// 服务状态管理（通过 Tauri manage 注入）
pub struct LocalLLMState {
    pub status: Mutex<LocalLLMStatus>,
    #[allow(dead_code)]
    child: Mutex<Option<std::process::Child>>,
}

impl Default for LocalLLMState {
    fn default() -> Self {
        Self {
            status: Mutex::new(LocalLLMStatus {
                running: false,
                port: 11434,
                pid: None,
                model_path: None,
                error: None,
            }),
            child: Mutex::new(None),
        }
    }
}

/// 检查端口是否被占用（简单 TCP 连接测试）
fn is_port_in_use(port: u16) -> bool {
    std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok()
}

/// 启动本地 llama-server
///
/// # Arguments
/// * `model_path` - GGUF 模型文件路径
/// * `port` - 监听端口（默认 11434）
/// * `n_ctx` - 上下文长度（默认 2048）
/// * `n_threads` - CPU 线程数（默认 auto）
#[tauri::command]
pub async fn start_local_llm(
    model_path: String,
    port: Option<u16>,
    n_ctx: Option<u32>,
    n_threads: Option<u32>,
    state: State<'_, LocalLLMState>,
    app: tauri::AppHandle,
) -> Result<LocalLLMStatus, String> {
    let port = port.unwrap_or(11434);

    // 检查是否已在运行
    {
        let status = state.status.lock().map_err(|e| e.to_string())?;
        if status.running && is_port_in_use(port) {
            return Ok(status.clone());
        }
    }

    // 尝试查找 llama-server 可执行文件
    let binary_name = if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    };

    // 查找顺序：同目录 > PATH > app 目录
    let binary_path = find_binary(&app, binary_name)?;

    // 验证模型文件存在
    let model = std::path::PathBuf::from(&model_path);
    if !model.exists() {
        let mut status = state.status.lock().map_err(|e| e.to_string())?;
        status.error = Some(format!("模型文件不存在: {}", model_path));
        return Ok(status.clone());
    }

    // 构建启动参数
    let mut args = vec![
        "-m".to_string(),
        model_path.clone(),
        "--port".to_string(),
        port.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
    ];

    if let Some(ctx) = n_ctx {
        args.push("--ctx-size".to_string());
        args.push(ctx.to_string());
    }

    if let Some(threads) = n_threads {
        args.push("--threads".to_string());
        args.push(threads.to_string());
    }

    // 启动进程
    let child = std::process::Command::new(&binary_path)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            let mut status = state.status.lock().unwrap_or_else(|e| e.into_inner());
            status.error = Some(format!("启动 llama-server 失败: {}", e));
            format!("启动 llama-server 失败: {}", e)
        })?;

    let pid = child.id();

    // 更新状态
    {
        let mut status = state.status.lock().map_err(|e| e.to_string())?;
        status.running = true;
        status.port = port;
        status.pid = Some(pid);
        status.model_path = Some(model_path);
        status.error = None;
    }

    // 保存进程句柄
    {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        *child_lock = Some(child);
    }

    // 等待一小段时间确认服务启动
    std::thread::sleep(std::time::Duration::from_millis(500));

    // 健康检查
    let healthy = check_health(port).await;
    if !healthy {
        let mut status = state.status.lock().map_err(|e| e.to_string())?;
        status.error = Some("服务启动但健康检查未通过，可能模型加载中".to_string());
        return Ok(status.clone());
    }

    log::info!("llama-server 已启动 (pid={}, port={})", pid, port);
    let status = state.status.lock().map_err(|e| e.to_string())?;
    Ok(status.clone())
}

/// 停止本地 llama-server
#[tauri::command]
pub async fn stop_local_llm(
    state: State<'_, LocalLLMState>,
) -> Result<LocalLLMStatus, String> {
    let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = *child_lock {
        // Windows 上 child.kill() 等价于 TerminateProcess（非 graceful）
        // llama-server 当前无内置优雅退出信号，保持强制终止语义并修正注释
        let _ = child.kill();
        let _ = child.wait();
    }
    *child_lock = None;

    let mut status = state.status.lock().map_err(|e| e.to_string())?;
    status.running = false;
    status.pid = None;
    status.error = None;

    log::info!("llama-server 已停止");
    Ok(status.clone())
}

/// 检查本地 LLM 服务健康状态
#[tauri::command]
pub async fn check_local_llm_health(
    state: State<'_, LocalLLMState>,
) -> Result<LocalLLMStatus, String> {
    // P1 修复：先取出需要的 port，立即释放锁，避免 MutexGuard 跨 await 导致 Future 不是 Send
    let port = {
        let status = state.status.lock().map_err(|e| e.to_string())?;
        if !status.running {
            return Ok(status.clone());
        }
        status.port
    };

    let healthy = check_health(port).await;
    if !healthy {
        // 检查进程是否还活着
        let alive = {
            let child_lock = state.child.lock().map_err(|e| e.to_string())?;
            child_lock.as_ref().map_or(false, |c| {
                // 跨平台进程存活检测
                // Windows: tasklist /FI "PID eq N"
                // Unix: kill -0（0 表示信号 0，仅检测进程是否存在，不实际发送信号）
                #[cfg(target_os = "windows")]
                {
                    std::process::Command::new("tasklist")
                        .args(["/FI", &format!("PID eq {}", c.id()), "/NH"])
                        .output()
                        .map(|o| {
                            let out = String::from_utf8_lossy(&o.stdout);
                            out.contains(&c.id().to_string())
                        })
                        .unwrap_or(false)
                }
                #[cfg(not(target_os = "windows"))]
                {
                    // Unix: kill -0 仅检测进程存在性，不实际发送信号
                    // exit code 0 = 存在，非 0 = 不存在或无权限
                    std::process::Command::new("kill")
                        .args(["-0", &c.id().to_string()])
                        .status()
                        .map(|s| s.success())
                        .unwrap_or(false)
                }
            })
        };

        if !alive {
            let mut status = state.status.lock().map_err(|e| e.to_string())?;
            status.running = false;
            status.pid = None;
            status.error = Some("进程已退出".to_string());
        }
    } else {
        let mut status = state.status.lock().map_err(|e| e.to_string())?;
        status.error = None;
    }

    let status = state.status.lock().map_err(|e| e.to_string())?;
    Ok(status.clone())
}

/// 获取本地 LLM 服务状态（不触发健康检查）
#[tauri::command]
pub async fn get_local_llm_status(
    state: State<'_, LocalLLMState>,
) -> Result<LocalLLMStatus, String> {
    let status = state.status.lock().map_err(|e| e.to_string())?;
    Ok(status.clone())
}

/// HTTP 健康检查
async fn check_health(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/v1/models", port);
    match reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// 查找 llama-server 可执行文件
fn find_binary(app: &tauri::AppHandle, name: &str) -> Result<String, String> {
    // 1. 检查 PATH
    if let Ok(path) = which::which(name) {
        return Ok(path.to_string_lossy().to_string());
    }

    // 2. 检查应用目录下的 bin/ 子目录
    let app_dir = app.path().app_config_dir().unwrap_or_default();
    let bin_path = app_dir.join("bin").join(name);
    if bin_path.exists() {
        return Ok(bin_path.to_string_lossy().to_string());
    }

    // 3. 检查当前可执行文件同目录
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let local_path = exe_dir.join(name);
            if local_path.exists() {
                return Ok(local_path.to_string_lossy().to_string());
            }
        }
    }

    Err(format!(
        "找不到 {}，请确保已安装 llama.cpp 并将 llama-server 添加到 PATH，\
         或放在应用目录的 bin/ 子目录下",
        name
    ))
}
