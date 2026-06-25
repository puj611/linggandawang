// rustc-wrapper: 解决TRAE沙箱/Windows环境下build script调用rustc --version
// 时出现 "Os { code: 0, message: 操作成功完成。" } panic的问题。
//
// 工作原理：
// 1. 把这个wrapper设置为RUSTC环境变量，替换真实rustc
// 2. 当检测到--version/-V/-vV等版本查询参数时，直接打印预定义的版本信息，
//    完全不启动子进程，避免触发进程创建错误
// 3. 其他情况（真正编译）转发给REAL_RUSTC环境变量指定的真实rustc

use std::env;
use std::process::{Command, exit};

const FAKE_VERSION: &str = "rustc 1.96.0 (ac68faa20 2026-05-25)
binary: rustc
commit-hash: ac68faa20c58cbccd01ee7208bf3b6e93a7d7f96
commit-date: 2026-05-25
host: x86_64-pc-windows-msvc
release: 1.96.0
LLVM version: 22.1.2";

fn is_version_query(args: &[String]) -> bool {
    // 只拦截纯版本查询，不拦截--print（很多构建脚本需要--print=cfg等信息）
    let has_version = args.iter().any(|a| a == "--version" || a == "-V" || a == "-vV");
    let has_print = args.iter().any(|a| a.starts_with("--print"));
    has_version && !has_print
}

fn main() {
    let args: Vec<String> = env::args().collect();

    // 第一个参数是wrapper自己的路径，跳过
    let real_args = if args.len() > 1 { &args[1..] } else { &[] };

    // 如果是版本查询/--print查询，直接返回伪造信息，不启动任何子进程
    if is_version_query(real_args) {
        print!("{}", FAKE_VERSION);
        exit(0);
    }

    // 真正的编译任务：转发给真实rustc
    let real_rustc = env::var("REAL_RUSTC").unwrap_or_else(|_| "rustc".to_string());
    let status = Command::new(&real_rustc)
        .args(real_args)
        .status()
        .unwrap_or_else(|e| {
            eprintln!("rustc-wrapper: failed to invoke real rustc at {}: {}", real_rustc, e);
            exit(1);
        });

    exit(status.code().unwrap_or(1));
}
