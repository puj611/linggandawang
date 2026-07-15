// src-tauri/src/lib.rs
// 主入口：模块声明 + SQLite 迁移 + Tauri 应用配置

mod commands;
mod scanner;

use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

use commands::context;
use commands::api_key;
use commands::project;
use commands::window;
use commands::image;
use commands::requirement;
use commands::sidecar;
use commands::project::ProjectScanState;
use commands::sidecar::LocalLLMState;

use std::sync::Mutex;

#[derive(Clone, Debug, serde::Serialize)]
struct ShortcutEvent {
    visible: bool,
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
        Migration {
            version: 4,
            description: "add_favorite_to_prompt_history",
            sql: include_str!("../migrations/0004_add_favorite_to_prompt_history.sql"),
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
            // Context commands
            context::save_context,
            context::load_context,
            context::archive_context,
            context::load_user_bank,
            context::save_user_bank,
            context::clear_user_bank,
            context::save_user_preference,
            context::load_user_preference,
            // Window commands
            window::save_window_position,
            window::load_window_position,
            // Image commands
            image::read_image_file,
            // API Key commands
            api_key::save_api_key,
            api_key::load_api_key,
            api_key::delete_api_key,
            // Project commands
            project::pick_project_folder,
            project::scan_project,
            project::full_scan_project,
            project::scan_file_tree_cmd,
            project::git_status_cmd,
            project::analyze_deps_cmd,
            // Requirement commands
            requirement::load_requirements,
            requirement::save_requirements,
            // Local LLM sidecar commands
            sidecar::start_local_llm,
            sidecar::stop_local_llm,
            sidecar::check_local_llm_health,
            sidecar::get_local_llm_status,
        ])
        .manage(ProjectScanState(Mutex::new(None)))
        .manage(LocalLLMState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 注册全局热键 Alt+Shift+Space 唤起/隐藏主窗口
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
