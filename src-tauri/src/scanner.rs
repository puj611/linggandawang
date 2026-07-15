use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;
use std::process::Command;

// ─── 忽略模式 ──────────────────────────────────────────────

const DEFAULT_IGNORE_DIRS: &[&str] = &[
    ".git", ".svn", ".hg", ".bzr",
    "node_modules", "target", "dist", "build", ".next", ".nuxt",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".tox",
    "vendor", ".gradle", ".idea", ".vscode",
    ".DS_Store", "Thumbs.db",
];

const DEFAULT_IGNORE_FILES: &[&str] = &[
    ".DS_Store", "Thumbs.db", "desktop.ini",
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
];

/// 读取 .gitignore 并合并默认忽略规则
fn load_ignore_patterns(root: &Path) -> HashSet<String> {
    let mut patterns: HashSet<String> = DEFAULT_IGNORE_DIRS
        .iter()
        .chain(DEFAULT_IGNORE_FILES.iter())
        .map(|s| s.to_string())
        .collect();

    let gitignore = root.join(".gitignore");
    if let Ok(content) = fs::read_to_string(&gitignore) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            // 简化处理：取最后一个路径段作为忽略名
            let name = trimmed.trim_start_matches('/').trim_end_matches('/');
            if !name.is_empty() {
                patterns.insert(name.to_string());
            }
        }
    }
    patterns
}

fn should_ignore(name: &str, ignore: &HashSet<String>) -> bool {
    ignore.contains(name)
}

// ─── 文件结构扫描 ──────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub ext: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileTree {
    pub root: String,
    pub total_files: usize,
    pub total_dirs: usize,
    pub total_size: u64,
    pub entries: Vec<FileEntry>,
    pub by_extension: BTreeMap<String, usize>,
}

fn scan_recursive(
    dir: &Path,
    root: &Path,
    ignore: &HashSet<String>,
    entries: &mut Vec<FileEntry>,
    by_ext: &mut BTreeMap<String, usize>,
    depth: usize,
    max_depth: usize,
    stats: &mut ScanStats,
) {
    if depth > max_depth {
        return;
    }

    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if should_ignore(&name, ignore) {
            continue;
        }

        let path = entry.path();
        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let rel = path.strip_prefix(root).unwrap_or(&path);
        let rel_str = rel.to_string_lossy().to_string();

        if metadata.is_dir() {
            stats.dirs += 1;
            entries.push(FileEntry {
                name,
                path: rel_str,
                is_dir: true,
                size: 0,
                ext: None,
            });
            scan_recursive(&path, root, ignore, entries, by_ext, depth + 1, max_depth, stats);
        } else {
            stats.files += 1;
            stats.total_size += metadata.len();

            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());
            if let Some(ref ext) = ext {
                *by_ext.entry(ext.clone()).or_insert(0) += 1;
            }

            entries.push(FileEntry {
                name,
                path: rel_str,
                is_dir: false,
                size: metadata.len(),
                ext,
            });
        }
    }
}

struct ScanStats {
    files: usize,
    dirs: usize,
    total_size: u64,
}

pub fn scan_file_tree(root: &Path, max_depth: usize) -> FileTree {
    let ignore = load_ignore_patterns(root);
    let mut entries = Vec::new();
    let mut by_ext = BTreeMap::new();
    let mut stats = ScanStats {
        files: 0,
        dirs: 0,
        total_size: 0,
    };

    scan_recursive(root, root, &ignore, &mut entries, &mut by_ext, 0, max_depth, &mut stats);

    // 按类型排序：目录在前，文件在后，同类型按名称排序
    entries.sort_by(|a, b| {
        a.is_dir
            .cmp(&b.is_dir)
            .reverse()
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    FileTree {
        root: root.to_string_lossy().to_string(),
        total_files: stats.files,
        total_dirs: stats.dirs,
        total_size: stats.total_size,
        entries,
        by_extension: by_ext,
    }
}

// ─── Git 状态解析 ──────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub changed_files: Vec<GitFileChange>,
    pub recent_commits: Vec<GitCommit>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitFileChange {
    pub status: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

pub fn parse_git_status(root: &Path) -> GitStatus {
    let mut result = GitStatus {
        is_repo: false,
        branch: None,
        changed_files: Vec::new(),
        recent_commits: Vec::new(),
    };

    // 检查是否是 git 仓库
    let git_dir = root.join(".git");
    if !git_dir.exists() || !git_dir.is_dir() {
        return result;
    }
    result.is_repo = true;

    // 获取当前分支
    if let Ok(output) = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(root)
        .output()
    {
        if output.status.success() {
            let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !branch.is_empty() {
                result.branch = Some(branch);
            }
        }
    }

    // 获取变更文件列表
    if let Ok(output) = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(root)
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.len() < 4 {
                    continue;
                }
                let status = line[0..2].trim().to_string();
                let path = line[3..].trim().to_string();
                if !path.is_empty() {
                    result.changed_files.push(GitFileChange { status, path });
                }
            }
        }
    }

    // 获取最近 10 条提交
    if let Ok(output) = Command::new("git")
        .args([
            "log", "--oneline", "-10", "--format=%h|%s|%an|%ai",
        ])
        .current_dir(root)
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.splitn(4, '|').collect();
                if parts.len() >= 4 {
                    result.recent_commits.push(GitCommit {
                        hash: parts[0].to_string(),
                        message: parts[1].to_string(),
                        author: parts[2].to_string(),
                        date: parts[3].to_string(),
                    });
                }
            }
        }
    }

    result
}

// ─── 依赖图分析 ──────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DependencyGraph {
    pub dependencies: BTreeMap<String, String>,
    pub dev_dependencies: BTreeMap<String, String>,
    pub scripts: BTreeMap<String, String>,
    pub tsconfig_paths: Option<BTreeMap<String, String>>,
    pub lock_file: Option<String>,
}

pub fn analyze_dependencies(root: &Path) -> DependencyGraph {
    let mut deps = BTreeMap::new();
    let mut dev_deps = BTreeMap::new();
    let mut scripts = BTreeMap::new();
    let mut tsconfig_paths = None;
    let mut lock_file = None;

    // 解析 package.json
    let pkg_path = root.join("package.json");
    if let Ok(content) = fs::read_to_string(&pkg_path) {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(obj) = pkg.as_object() {
                if let Some(d) = obj.get("dependencies").and_then(|v| v.as_object()) {
                    for (k, v) in d {
                        if let Some(s) = v.as_str() {
                            deps.insert(k.clone(), s.to_string());
                        }
                    }
                }
                if let Some(d) = obj.get("devDependencies").and_then(|v| v.as_object()) {
                    for (k, v) in d {
                        if let Some(s) = v.as_str() {
                            dev_deps.insert(k.clone(), s.to_string());
                        }
                    }
                }
                if let Some(s) = obj.get("scripts").and_then(|v| v.as_object()) {
                    for (k, v) in s {
                        if let Some(s) = v.as_str() {
                            scripts.insert(k.clone(), s.to_string());
                        }
                    }
                }
            }
        }
    }

    // 解析 tsconfig.json 的 paths
    let tsconfig_path = root.join("tsconfig.json");
    if let Ok(content) = fs::read_to_string(&tsconfig_path) {
        if let Ok(tsconfig) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(obj) = tsconfig.as_object() {
                if let Some(compiler) = obj.get("compilerOptions").and_then(|v| v.as_object()) {
                    if let Some(paths) = compiler.get("paths").and_then(|v| v.as_object()) {
                        let mut m = BTreeMap::new();
                        for (k, v) in paths {
                            if let Some(arr) = v.as_array() {
                                if let Some(Some(s)) = arr.first().map(|v| v.as_str()) {
                                    m.insert(k.clone(), s.to_string());
                                }
                            }
                        }
                        if !m.is_empty() {
                            tsconfig_paths = Some(m);
                        }
                    }
                }
            }
        }
    }

    // 检测锁文件
    for lock_name in &["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb"] {
        if root.join(lock_name).exists() {
            lock_file = Some(lock_name.to_string());
            break;
        }
    }

    DependencyGraph {
        dependencies: deps,
        dev_dependencies: dev_deps,
        scripts,
        tsconfig_paths,
        lock_file,
    }
}

// ─── TODO/FIXME 扫描 ──────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TodoItem {
    pub file: String,
    pub line: usize,
    pub tag: String,
    pub content: String,
}

const TODO_PATTERNS: &[&str] = &[
    "TODO", "FIXME", "HACK", "XXX", "WARN", "BUG",
];

pub fn scan_todos(root: &Path, ignore: &HashSet<String>) -> Vec<TodoItem> {
    let mut items = Vec::new();
    scan_todos_recursive(root, root, ignore, &mut items, 0, 8);
    items
}

fn scan_todos_recursive(
    dir: &Path,
    root: &Path,
    ignore: &HashSet<String>,
    items: &mut Vec<TodoItem>,
    depth: usize,
    max_depth: usize,
) {
    if depth > max_depth {
        return;
    }

    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if should_ignore(&name, ignore) {
            continue;
        }

        let path = entry.path();
        if path.is_dir() {
            scan_todos_recursive(&path, root, ignore, items, depth + 1, max_depth);
            continue;
        }

        // 只扫描文本文件
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let text_exts = [
            "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h",
            "css", "scss", "less", "html", "vue", "svelte", "md", "txt", "yaml", "yml",
            "json", "toml", "sql", "sh", "bat", "ps1",
        ];
        if !text_exts.contains(&ext.as_str()) {
            continue;
        }

        if let Ok(content) = fs::read_to_string(&path) {
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel_str = rel.to_string_lossy().to_string();

            for (line_num, line) in content.lines().enumerate() {
                for pattern in TODO_PATTERNS {
                    if let Some(pos) = line.find(pattern) {
                        let before = line[..pos].trim();
                        let after = line[pos + pattern.len()..].trim();
                        let tag = pattern.to_string();
                        let content_text = if after.starts_with(':') || after.starts_with('(') {
                            after.trim_start_matches(':').trim_start_matches('(').trim_start_matches(')').trim().to_string()
                        } else {
                            after.to_string()
                        };
                        if !content_text.is_empty() || !before.is_empty() {
                            items.push(TodoItem {
                                file: rel_str.clone(),
                                line: line_num + 1,
                                tag,
                                content: if content_text.is_empty() {
                                    before.to_string()
                                } else {
                                    content_text
                                },
                            });
                        }
                        break;
                    }
                }
            }
        }
    }
}

// ─── 扫描结果汇总 ──────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FullScanResult {
    pub file_tree: FileTree,
    pub git: GitStatus,
    pub dependencies: DependencyGraph,
    pub todos: Vec<TodoItem>,
    pub scan_time_ms: u64,
}

pub fn full_scan(root: &Path, max_depth: usize) -> FullScanResult {
    let start = std::time::Instant::now();

    let ignore = load_ignore_patterns(root);
    let file_tree = scan_file_tree(root, max_depth);
    let git = parse_git_status(root);
    let dependencies = analyze_dependencies(root);
    let todos = scan_todos(root, &ignore);

    let scan_time_ms = start.elapsed().as_millis() as u64;

    FullScanResult {
        file_tree,
        git,
        dependencies,
        todos,
        scan_time_ms,
    }
}
