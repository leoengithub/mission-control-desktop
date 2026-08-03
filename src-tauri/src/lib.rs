mod activation;
mod attention;
mod contextual_setup;
mod database;
mod github;
mod github_auth;
mod notifications;
mod settings;
mod sync;

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use activation::{ActivationState, resolve_activation_state};
use attention::{AttentionItem, AttentionRepository};
use database::Database;
use github_auth::{DeviceAuthorization, DeviceAuthorizationPoll, GithubAuthService};
use serde::Serialize;
use settings::{AppSettings, SettingsPatch, SettingsStore};
use sync::{CachedPullRequest, GithubSyncResult, GithubSyncService, list_cached_pull_requests};
use tauri::{AppHandle, Manager, State};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

const DATABASE_SCHEMA_VERSION: u32 = 1;

struct AppState {
    settings: Mutex<SettingsStore>,
    database: Database,
    github_auth: Option<GithubAuthService>,
    github_sync: Option<GithubSyncService>,
    sync_lock: tokio::sync::Mutex<()>,
    last_sync: Mutex<Option<Instant>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FoundationStatus {
    settings_schema_version: u32,
    database_schema_version: u32,
    github_app_configured: bool,
    actionable_poll_seconds: u32,
    discovery_poll_seconds: u32,
}

#[tauri::command]
fn get_foundation_status(state: State<'_, AppState>) -> Result<FoundationStatus, String> {
    state.database.verify().map_err(|error| error.to_string())?;
    let store = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?;
    let (actionable_poll_seconds, discovery_poll_seconds) =
        store.current().sync.preset.intervals_seconds();
    Ok(FoundationStatus {
        settings_schema_version: settings::SETTINGS_SCHEMA_VERSION,
        database_schema_version: DATABASE_SCHEMA_VERSION,
        github_app_configured: option_env!("MC_GITHUB_CLIENT_ID").is_some(),
        actionable_poll_seconds,
        discovery_poll_seconds,
    })
}

#[tauri::command]
fn get_activation_state(state: State<'_, AppState>) -> Result<ActivationState, String> {
    resolve_activation_state(
        &state.database,
        option_env!("MC_GITHUB_CLIENT_ID").is_some(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let store = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?;
    Ok(store.current().clone())
}

#[tauri::command]
fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<AppSettings, String> {
    let mut store = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?;
    let previous_general = store.current().general.clone();
    let updated = store.update(patch).map_err(|error| error.to_string())?;
    let launch_changed = previous_general.launch_at_login != updated.general.launch_at_login;
    drop(store);

    if launch_changed {
        let result = if updated.general.launch_at_login {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        if let Err(error) = result {
            if let Ok(mut store) = state.settings.lock() {
                let _ = store.update(SettingsPatch {
                    general: Some(previous_general),
                    ..SettingsPatch::default()
                });
            }
            return Err(format!("could not update launch at login: {error}"));
        }
    }
    Ok(updated)
}

#[tauri::command]
fn list_attention_items(state: State<'_, AppState>) -> Result<Vec<AttentionItem>, String> {
    AttentionRepository::new(&state.database)
        .list_active()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_pull_requests(state: State<'_, AppState>) -> Result<Vec<CachedPullRequest>, String> {
    list_cached_pull_requests(&state.database).map_err(|error| error.to_string())
}

#[tauri::command]
async fn refresh_inbox(state: State<'_, AppState>) -> Result<GithubSyncResult, String> {
    let _guard = state.sync_lock.lock().await;
    run_github_sync(&state).await
}

async fn run_github_sync(state: &AppState) -> Result<GithubSyncResult, String> {
    let auth = state
        .github_auth
        .as_ref()
        .ok_or("GitHub App client ID is not configured")?;
    let sync = state
        .github_sync
        .as_ref()
        .ok_or("GitHub transport could not be initialized")?;
    let access_token = auth
        .access_token(&state.database)
        .await
        .map_err(|error| error.to_string())?;
    match sync.refresh(&state.database, &access_token).await {
        Ok((result, _transitions)) => {
            *state
                .last_sync
                .lock()
                .map_err(|_| "sync clock lock poisoned")? = Some(Instant::now());
            Ok(result)
        }
        Err(error) => {
            record_sync_error(&state.database, &error.to_string());
            Err(error.to_string())
        }
    }
}

fn record_sync_error(database: &Database, message: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let _ = database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO app_state (key, value, updated_at) VALUES ('last_sync_error', ?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            rusqlite::params![message, now],
        )?;
        Ok(())
    });
}

fn background_interval(state: &AppState) -> Duration {
    let preset = state
        .settings
        .lock()
        .map(|settings| settings.current().sync.preset)
        .unwrap_or_default();
    let (actionable, discovery) = preset.intervals_seconds();
    let has_actionable_scope = state
        .database
        .with_connection(|connection| {
            connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM pull_requests p \
                 JOIN github_accounts a ON a.login = p.author_login \
                 WHERE p.in_scope = 1 AND p.state = 'OPEN') OR \
                 EXISTS(SELECT 1 FROM attention_items WHERE cleared_at IS NULL)",
                [],
                |row| row.get::<_, bool>(0),
            )
        })
        .unwrap_or(false);
    Duration::from_secs(u64::from(if has_actionable_scope {
        actionable
    } else {
        discovery
    }))
}

#[tauri::command]
async fn start_github_authorization(
    state: State<'_, AppState>,
) -> Result<DeviceAuthorization, String> {
    let service = state
        .github_auth
        .as_ref()
        .ok_or("GitHub App client ID is not configured")?;
    service.start().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn poll_github_authorization(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<DeviceAuthorizationPoll, String> {
    let service = state
        .github_auth
        .as_ref()
        .ok_or("GitHub App client ID is not configured")?;
    service
        .poll(&session_id, &state.database)
        .await
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let settings = SettingsStore::load(config_dir.join("settings.json"))?;
            let launch_at_login = settings.current().general.launch_at_login;
            let database = Database::open(data_dir.join("mission-control.sqlite3"))?;
            app.manage(AppState {
                settings: Mutex::new(settings),
                database,
                github_auth: GithubAuthService::new().ok(),
                github_sync: GithubSyncService::new().ok(),
                sync_lock: tokio::sync::Mutex::new(()),
                last_sync: Mutex::new(None),
            });
            if launch_at_login {
                app.autolaunch().enable()?;
            } else {
                app.autolaunch().disable()?;
            }

            let background_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    let state = background_app.state::<AppState>();
                    let due = state
                        .last_sync
                        .lock()
                        .map(|last_sync| {
                            last_sync
                                .is_none_or(|last| last.elapsed() >= background_interval(&state))
                        })
                        .unwrap_or(false);
                    if !due {
                        continue;
                    }
                    let has_account = state
                        .database
                        .with_connection(|connection| {
                            connection.query_row(
                                "SELECT EXISTS(SELECT 1 FROM github_accounts \
                                 WHERE needs_reauthorization = 0)",
                                [],
                                |row| row.get::<_, bool>(0),
                            )
                        })
                        .unwrap_or(false);
                    if !has_account {
                        continue;
                    }
                    let Ok(_guard) = state.sync_lock.try_lock() else {
                        continue;
                    };
                    let _ = run_github_sync(&state).await;
                    if let Ok(mut last_sync) = state.last_sync.lock() {
                        *last_sync = Some(Instant::now());
                    }
                }
            });

            let show = MenuItem::with_id(app, "show", "Show Mission Control", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Mission Control", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let should_hide = state
                    .settings
                    .lock()
                    .map(|settings| {
                        settings.current().general.close_behavior
                            == settings::CloseBehavior::MenuBar
                    })
                    .unwrap_or(true);
                if should_hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_foundation_status,
            get_activation_state,
            get_settings,
            update_settings,
            list_attention_items,
            list_pull_requests,
            refresh_inbox,
            start_github_authorization,
            poll_github_authorization
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mission Control");
}
