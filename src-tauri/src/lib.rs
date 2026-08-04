mod activation;
mod agent;
mod attention;
mod contextual_setup;
mod database;
mod github;
mod github_auth;
mod notifications;
mod review;
mod settings;
mod sync;
mod workspace;

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use activation::{ActivationState, resolve_activation_state};
use agent::{AgentAction, AgentAvailability, AgentRun, AgentRuntime};
use attention::{AttentionItem, AttentionRepository};
use contextual_setup::{ContextualPrompt, ContextualSetupContext, recommended_prompts};
use database::Database;
use github_auth::{
    DeviceAuthorization, DeviceAuthorizationPoll, GithubAuthService, github_client_id,
};
use notifications::{NativeNotificationTransport, deliver_transitions};
use review::PullRequestReviewDetail;
use serde::{Deserialize, Serialize};
use settings::{AgentKind, AppSettings, SettingsPatch, SettingsStore, WorktreeCleanupPolicy};
use sync::{
    CachedPullRequest, GithubSyncError, GithubSyncResult, GithubSyncService,
    list_cached_pull_requests,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_notification::{NotificationExt, PermissionState};
use workspace::LocalRepositoryAttachment;

const DATABASE_SCHEMA_VERSION: u32 = 2;
const INBOX_SYNC_EVENT: &str = "mission-control://inbox-sync";
const MAIN_TRAY_ID: &str = "main-tray";

struct AppState {
    settings: Mutex<SettingsStore>,
    database: Arc<Database>,
    agent_runtime: AgentRuntime,
    logs_directory: PathBuf,
    github_auth: Option<GithubAuthService>,
    github_sync: Option<GithubSyncService>,
    sync_lock: tokio::sync::Mutex<()>,
    last_sync: Mutex<Option<Instant>>,
    next_sync_not_before: Mutex<Option<Instant>>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SyncTrigger {
    Manual,
    Focus,
    Activation,
    Background,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InboxSyncEvent {
    status: &'static str,
    trigger: SyncTrigger,
    result: Option<GithubSyncResult>,
    error: Option<String>,
    retry_after_seconds: Option<u64>,
    attention_pull_request_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum NotificationPermission {
    Granted,
    Denied,
    Prompt,
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
        github_app_configured: github_client_id().is_some(),
        actionable_poll_seconds,
        discovery_poll_seconds,
    })
}

#[tauri::command]
fn get_activation_state(state: State<'_, AppState>) -> Result<ActivationState, String> {
    resolve_activation_state(&state.database, github_client_id().is_some())
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
fn get_notification_permission(app: AppHandle) -> Result<NotificationPermission, String> {
    app.notification()
        .permission_state()
        .map(notification_permission)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn request_notification_permission(app: AppHandle) -> Result<NotificationPermission, String> {
    app.notification()
        .request_permission()
        .map(notification_permission)
        .map_err(|error| error.to_string())
}

fn notification_permission(permission: PermissionState) -> NotificationPermission {
    match permission {
        PermissionState::Granted => NotificationPermission::Granted,
        PermissionState::Denied => NotificationPermission::Denied,
        PermissionState::Prompt | PermissionState::PromptWithRationale => {
            NotificationPermission::Prompt
        }
    }
}

#[tauri::command]
fn list_contextual_prompts(state: State<'_, AppState>) -> Result<Vec<ContextualPrompt>, String> {
    let activation_ready = resolve_activation_state(&state.database, github_client_id().is_some())
        .map_err(|error| error.to_string())?
        .step
        == activation::ActivationStep::Ready;
    let unsnoozed_attention_count = AttentionRepository::new(&state.database)
        .active_pull_request_count(chrono::Utc::now())
        .map_err(|error| error.to_string())?;
    let attached_local_repository_count = state
        .database
        .with_connection(|connection| {
            connection.query_row("SELECT COUNT(*) FROM local_repositories", [], |row| {
                row.get(0)
            })
        })
        .map_err(|error| error.to_string())?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?
        .current()
        .clone();
    let prompts = recommended_prompts(
        &settings,
        ContextualSetupContext {
            activation_ready,
            unsnoozed_attention_count,
            local_action_attempted: false,
            attached_local_repository_count,
            detected_agent_count: 0,
        },
    )
    .into_iter()
    .filter(|prompt| {
        matches!(
            prompt,
            ContextualPrompt::EnableNotifications | ContextualPrompt::EnableLaunchAtLogin
        )
    })
    .collect();
    Ok(prompts)
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
fn get_pull_request_review_detail(
    state: State<'_, AppState>,
    pull_request_id: String,
) -> Result<PullRequestReviewDetail, String> {
    review::get_review_detail(&state.database, &pull_request_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn mark_pull_request_seen(
    state: State<'_, AppState>,
    pull_request_id: String,
) -> Result<(), String> {
    review::mark_pull_request_seen(&state.database, &pull_request_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_local_repositories(
    state: State<'_, AppState>,
) -> Result<Vec<LocalRepositoryAttachment>, String> {
    workspace::list_local_repositories(&state.database).map_err(|error| error.to_string())
}

#[tauri::command]
fn attach_local_repository(
    state: State<'_, AppState>,
    repository_id: String,
    local_path: String,
) -> Result<LocalRepositoryAttachment, String> {
    workspace::attach_local_repository(&state.database, &repository_id, &local_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn detect_agents() -> Vec<AgentAvailability> {
    agent::detect_agents()
}

#[tauri::command]
fn list_agent_runs(
    state: State<'_, AppState>,
    pull_request_id: String,
) -> Result<Vec<AgentRun>, String> {
    agent::list_runs(&state.database, &pull_request_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_agent_run_log(state: State<'_, AppState>, run_id: String) -> Result<String, String> {
    agent::read_run_log(&state.database, &run_id).map_err(|error| error.to_string())
}

#[tauri::command]
async fn request_copilot_review(
    state: State<'_, AppState>,
    pull_request_id: String,
) -> Result<(), String> {
    let (repository, number) = state
        .database
        .with_connection(|connection| {
            connection.query_row(
                "SELECT r.full_name, p.number FROM pull_requests p \
                 JOIN repositories r ON r.id = p.repository_id WHERE p.id = ?1",
                [&pull_request_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
        })
        .map_err(|error| error.to_string())?;
    let token = github_access_token(&state).await?;
    let sync = state
        .github_sync
        .as_ref()
        .ok_or("GitHub transport could not be initialized")?;
    sync.request_copilot_review(&token, &repository, number)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn reply_and_resolve(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    selected_agent: AgentKind,
    existing_run_id: Option<String>,
) -> Result<AgentRun, String> {
    let (pull_request_id, repository_path) =
        attached_repository_for_thread(&state.database, &thread_id)?;
    let settings = current_settings(&state)?;
    let run = if let Some(run_id) = existing_run_id {
        let existing =
            agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())?;
        if existing.thread_id.as_deref() != Some(&thread_id)
            || existing.action != AgentAction::ReplyResolve.as_str()
        {
            return Err("the selected run cannot resume this review thread".into());
        }
        agent::restart_run(&state.database, &run_id).map_err(|error| error.to_string())?;
        agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())?
    } else {
        agent::create_noninteractive_run(
            &state.database,
            &pull_request_id,
            &thread_id,
            selected_agent,
            &repository_path,
        )
        .map_err(|error| error.to_string())?
    };
    let run_id = run.id.clone();
    let result: Result<(), String> = async {
        let current = agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())?;
        let token = github_access_token(&state).await?;
        let sync = state
            .github_sync
            .as_ref()
            .ok_or("GitHub transport could not be initialized")?;
        if current.reply_posted_at.is_none() {
            let context = review::thread_prompt_context(&state.database, &thread_id)
                .map_err(|error| error.to_string())?;
            let prompt = format!(
                "Draft the exact concise GitHub review-thread reply for the conversation below. \
                 Inspect the repository when useful, but do not modify files, run destructive commands, \
                 or claim work that is not evidenced. Return only the reply body, with no heading or fences.\n\n{context}"
            );
            let reply = agent::run_agent_reply(
                selected_agent,
                &prompt,
                &repository_path,
                &settings,
            )
            .await
            .map_err(|error| error.to_string())?;
            sync.reply_to_thread(&token, &thread_id, &reply)
                .await
                .map_err(|error| error.to_string())?;
            agent::mark_reply_posted(&state.database, &run_id)
                .map_err(|error| error.to_string())?;
        }
        let current = agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())?;
        if current.resolved_at.is_none() {
            sync.resolve_thread(&token, &thread_id)
                .await
                .map_err(|error| error.to_string())?;
            agent::mark_resolved(&state.database, &run_id).map_err(|error| error.to_string())?;
        }
        mark_thread_resolved(&state.database, &thread_id)?;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => agent::update_run_status(
            &state.database,
            &run_id,
            "completed",
            Some("Reply posted and review thread resolved"),
        )
        .map_err(|error| error.to_string())?,
        Err(error) => {
            let _ = agent::update_run_status(&state.database, &run_id, "failed", Some(&error));
            activate_agent_attention(
                &app,
                &state,
                &pull_request_id,
                &run_id,
                attention::AttentionReason::AgentFailed,
                "Reply workflow failed and needs attention",
            );
            return Err(error);
        }
    }
    clear_agent_attention(&app, &state, &pull_request_id, &run_id);
    agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn start_fix_session(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    selected_agent: AgentKind,
) -> Result<AgentRun, String> {
    let pull_request_id = pull_request_id_for_thread(&state.database, &thread_id)?;
    let settings = current_settings(&state)?;
    let context = workspace::ensure_worktree(
        &state.database,
        &settings,
        &pull_request_id,
        &thread_id,
        AgentAction::FixReplyResolve.as_str(),
    )
    .map_err(|error| error.to_string())?;
    let review_context = review::thread_prompt_context(&state.database, &thread_id)
        .map_err(|error| error.to_string())?;
    let prompt = format!(
        "Address this review feedback in the current detached worktree. Inspect the code first, \
         make only the necessary changes, and run focused verification. Do not commit or push. \
         When finished, summarize the changed files and verification, then wait for the user to \
         complete and resolve the workflow.\n\n{review_context}"
    );
    state
        .agent_runtime
        .start_terminal(agent::TerminalStartRequest {
            app,
            database: state.database.clone(),
            logs_directory: &state.logs_directory,
            pull_request_id: &pull_request_id,
            thread_id: Some(&thread_id),
            action: AgentAction::FixReplyResolve,
            agent: Some(selected_agent),
            working_directory: &context.worktree_path,
            prompt: Some(prompt),
            base_head_sha: Some(&context.head_sha),
            settings: &settings,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_thread_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<AgentRun, String> {
    let pull_request_id = pull_request_id_for_thread(&state.database, &thread_id)?;
    let settings = current_settings(&state)?;
    let context = workspace::ensure_worktree(
        &state.database,
        &settings,
        &pull_request_id,
        &thread_id,
        AgentAction::OpenTerminal.as_str(),
    )
    .map_err(|error| error.to_string())?;
    state
        .agent_runtime
        .start_terminal(agent::TerminalStartRequest {
            app,
            database: state.database.clone(),
            logs_directory: &state.logs_directory,
            pull_request_id: &pull_request_id,
            thread_id: Some(&thread_id),
            action: AgentAction::OpenTerminal,
            agent: None,
            working_directory: &context.worktree_path,
            prompt: None,
            base_head_sha: Some(&context.head_sha),
            settings: &settings,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_input(state: State<'_, AppState>, run_id: String, data: String) -> Result<(), String> {
    state
        .agent_runtime
        .write(&run_id, &data)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, AppState>,
    run_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .agent_runtime
        .resize(&run_id, cols, rows)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminate_agent_run(state: State<'_, AppState>, run_id: String) -> Result<(), String> {
    state
        .agent_runtime
        .terminate(&run_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn complete_fix_session(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<AgentRun, String> {
    if state.agent_runtime.is_active(&run_id) {
        return Err("finish or stop the terminal session before posting its reply".into());
    }
    let run = agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())?;
    if run.action != AgentAction::FixReplyResolve.as_str() {
        return Err("only a fix session can be completed from this action".into());
    }
    let thread_id = run
        .thread_id
        .clone()
        .ok_or("the agent run is not linked to a review thread")?;
    let worktree_path = PathBuf::from(
        run.worktree_path
            .as_deref()
            .ok_or("the agent run has no preserved worktree")?,
    );
    let selected_agent = parse_agent_kind(&run.agent)?;
    let settings = current_settings(&state)?;
    agent::restart_run(&state.database, &run_id).map_err(|error| error.to_string())?;
    let result: Result<String, String> = async {
        let token = github_access_token(&state).await?;
        let sync = state
            .github_sync
            .as_ref()
            .ok_or("GitHub transport could not be initialized")?;
        let current = agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())?;
        if current.reply_posted_at.is_none() {
            let context = review::thread_prompt_context(&state.database, &thread_id)
                .map_err(|error| error.to_string())?;
            let evidence = git_change_evidence(
                &worktree_path,
                run.base_head_sha
                    .as_deref()
                    .ok_or("the fix run does not record its original pull request head")?,
            )?;
            let prompt = format!(
                "Draft the exact concise GitHub reply for this review thread after a local fix. \
                 Use only the supplied repository evidence. Mention the fix and verification without \
                 overstating results. Return only the reply body, with no heading or fences.\n\n{context}\n\nLocal evidence:\n{evidence}"
            );
            let reply = agent::run_agent_reply(
                selected_agent,
                &prompt,
                &worktree_path,
                &settings,
            )
            .await
            .map_err(|error| error.to_string())?;
            sync.reply_to_thread(&token, &thread_id, &reply)
                .await
                .map_err(|error| error.to_string())?;
            agent::mark_reply_posted(&state.database, &run_id)
                .map_err(|error| error.to_string())?;
        }
        let current = agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())?;
        if current.resolved_at.is_none() {
            sync.resolve_thread(&token, &thread_id)
                .await
                .map_err(|error| error.to_string())?;
            agent::mark_resolved(&state.database, &run_id).map_err(|error| error.to_string())?;
        }
        mark_thread_resolved(&state.database, &thread_id)?;
        Ok(cleanup_completed_worktree(&state, &run, &settings))
    }
    .await;
    let summary = match result {
        Ok(cleanup) => format!("Reply posted and review thread resolved. {cleanup}"),
        Err(error) => {
            let _ = agent::update_run_status(&state.database, &run_id, "failed", Some(&error));
            activate_agent_attention(
                &app,
                &state,
                &run.pull_request_id,
                &run_id,
                attention::AttentionReason::AgentFailed,
                "Completing the fix workflow failed",
            );
            return Err(error);
        }
    };
    agent::update_run_status(&state.database, &run_id, "completed", Some(&summary))
        .map_err(|error| error.to_string())?;
    clear_agent_attention(&app, &state, &run.pull_request_id, &run_id);
    agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn cleanup_agent_worktree(state: State<'_, AppState>, run_id: String) -> Result<(), String> {
    if state.agent_runtime.is_active(&run_id) {
        return Err("the worktree is still in use by an active terminal session".into());
    }
    let run = agent::get_run(&state.database, &run_id).map_err(|error| error.to_string())?;
    let worktree_path = PathBuf::from(
        run.worktree_path
            .as_deref()
            .ok_or("the agent run has no worktree")?,
    );
    let expected_head = run
        .base_head_sha
        .as_deref()
        .ok_or("the agent run does not record its original head")?;
    let (repository_path, configured_base) = cleanup_paths(&state, &run, &worktree_path)?;
    workspace::cleanup_worktree(
        &repository_path,
        &worktree_path,
        &configured_base,
        expected_head,
    )
    .map_err(|error| error.to_string())
}

fn activate_agent_attention(
    app: &AppHandle,
    state: &AppState,
    pull_request_id: &str,
    run_id: &str,
    reason: attention::AttentionReason,
    summary: &str,
) {
    let repository = AttentionRepository::new(&state.database);
    let Ok(Some(transition)) = repository.activate_candidate(
        pull_request_id,
        attention::AttentionCandidate {
            reason,
            source_id: Some(run_id.into()),
            summary: summary.into(),
        },
        chrono::Utc::now(),
    ) else {
        return;
    };
    if let Ok(settings) = current_settings(state) {
        let _ = deliver_transitions(
            &state.database,
            &settings.notifications,
            &[transition],
            &NativeNotificationTransport::new(app.clone()),
        );
    }
    refresh_attention_badges(app, active_attention_count(state));
}

fn clear_agent_attention(app: &AppHandle, state: &AppState, pull_request_id: &str, run_id: &str) {
    let repository = AttentionRepository::new(&state.database);
    for reason in [
        attention::AttentionReason::AgentWaitingForUser,
        attention::AttentionReason::AgentFailed,
        attention::AttentionReason::AgentStalled,
        attention::AttentionReason::AgentInterrupted,
    ] {
        let _ =
            repository.clear_candidate(pull_request_id, reason, Some(run_id), chrono::Utc::now());
    }
    refresh_attention_badges(app, active_attention_count(state));
}

async fn github_access_token(state: &AppState) -> Result<String, String> {
    let auth = state
        .github_auth
        .as_ref()
        .ok_or("GitHub App client ID is not configured")?;
    auth.access_token(&state.database)
        .await
        .map_err(|error| error.to_string())
}

fn current_settings(state: &AppState) -> Result<AppSettings, String> {
    state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_owned())
        .map(|store| store.current().clone())
}

fn pull_request_id_for_thread(database: &Database, thread_id: &str) -> Result<String, String> {
    database
        .with_connection(|connection| {
            connection.query_row(
                "SELECT pull_request_id FROM review_threads WHERE id = ?1",
                [thread_id],
                |row| row.get(0),
            )
        })
        .map_err(|error| error.to_string())
}

fn attached_repository_for_thread(
    database: &Database,
    thread_id: &str,
) -> Result<(String, PathBuf), String> {
    database
        .with_connection(|connection| {
            connection.query_row(
                "SELECT t.pull_request_id, lr.local_path FROM review_threads t \
                 JOIN pull_requests p ON p.id = t.pull_request_id \
                 JOIN local_repositories lr ON lr.repository_id = p.repository_id \
                 WHERE t.id = ?1 AND lr.validation_state = 'valid'",
                [thread_id],
                |row| Ok((row.get(0)?, PathBuf::from(row.get::<_, String>(1)?))),
            )
        })
        .map_err(|error| match error {
            database::DatabaseError::Sql(rusqlite::Error::QueryReturnedNoRows) => {
                "attach this GitHub repository in Settings before starting an agent action".into()
            }
            other => other.to_string(),
        })
}

fn mark_thread_resolved(database: &Database, thread_id: &str) -> Result<(), String> {
    database
        .with_connection(|connection| {
            connection.execute(
                "UPDATE review_threads SET resolved = 1, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![chrono::Utc::now().to_rfc3339(), thread_id],
            )?;
            Ok(())
        })
        .map_err(|error| error.to_string())
}

fn parse_agent_kind(value: &str) -> Result<AgentKind, String> {
    match value {
        "codex" => Ok(AgentKind::Codex),
        "claude_code" => Ok(AgentKind::ClaudeCode),
        _ => Err(format!("unsupported agent for this workflow: {value}")),
    }
}

fn git_change_evidence(worktree_path: &Path, base_head_sha: &str) -> Result<String, String> {
    let output = |arguments: &[&str]| -> Result<String, String> {
        let output = std::process::Command::new("git")
            .args(arguments)
            .current_dir(worktree_path)
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    };
    let status = output(&["status", "--short"])?;
    let commits = output(&["log", "--oneline", &format!("{base_head_sha}..HEAD")])?;
    let stat = output(&["diff", "--stat", base_head_sha])?;
    let diff = output(&["diff", "--no-ext-diff", "--unified=2", base_head_sha])?;
    let mut evidence = format!(
        "Status:\n{status}\n\nCommits after the original pull request head:\n{commits}\n\nDiff stat:\n{stat}\n\nDiff:\n{diff}"
    );
    const MAX_EVIDENCE_BYTES: usize = 80_000;
    if evidence.len() > MAX_EVIDENCE_BYTES {
        evidence.truncate(MAX_EVIDENCE_BYTES);
        evidence.push_str("\n\n[Diff truncated by Mission Control]");
    }
    Ok(evidence)
}

fn cleanup_paths(
    state: &AppState,
    run: &AgentRun,
    worktree_path: &Path,
) -> Result<(PathBuf, PathBuf), String> {
    let repository_path = state
        .database
        .with_connection(|connection| {
            connection.query_row(
                "SELECT lr.local_path FROM pull_requests p \
                 JOIN local_repositories lr ON lr.repository_id = p.repository_id \
                 WHERE p.id = ?1 AND lr.validation_state = 'valid'",
                [&run.pull_request_id],
                |row| row.get::<_, String>(0).map(PathBuf::from),
            )
        })
        .map_err(|error| error.to_string())?;
    let configured_base = current_settings(state)?
        .worktrees
        .base_directory
        .unwrap_or_else(|| {
            repository_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(".mission-control-worktrees")
        });
    if !worktree_path.starts_with(&configured_base) {
        return Err("worktree is outside the configured Mission Control directory".into());
    }
    Ok((repository_path, configured_base))
}

fn cleanup_completed_worktree(state: &AppState, run: &AgentRun, settings: &AppSettings) -> String {
    match settings.worktrees.cleanup_policy {
        WorktreeCleanupPolicy::AlwaysPreserve => {
            return "The worktree was preserved by your cleanup policy.".into();
        }
        WorktreeCleanupPolicy::AlwaysAsk => {
            return "The worktree was preserved for manual cleanup.".into();
        }
        WorktreeCleanupPolicy::SafeOnly => {}
    }
    let Some(worktree_path) = run.worktree_path.as_deref().map(PathBuf::from) else {
        return "No worktree cleanup was needed.".into();
    };
    let Some(expected_head) = run.base_head_sha.as_deref() else {
        return "The worktree was preserved because its original head was unavailable.".into();
    };
    let Ok((repository_path, configured_base)) = cleanup_paths(state, run, &worktree_path) else {
        return "The worktree was preserved because its cleanup boundary could not be verified."
            .into();
    };
    match workspace::cleanup_worktree(
        &repository_path,
        &worktree_path,
        &configured_base,
        expected_head,
    ) {
        Ok(()) => "The unchanged worktree was removed safely.".into(),
        Err(error) => format!("The worktree was preserved: {error}."),
    }
}

#[tauri::command]
async fn refresh_inbox(
    app: AppHandle,
    state: State<'_, AppState>,
    trigger: Option<SyncTrigger>,
) -> Result<GithubSyncResult, String> {
    let _guard = state.sync_lock.lock().await;
    run_github_sync(&app, &state, trigger.unwrap_or(SyncTrigger::Manual)).await
}

async fn run_github_sync(
    app: &AppHandle,
    state: &AppState,
    trigger: SyncTrigger,
) -> Result<GithubSyncResult, String> {
    let Some(auth) = state.github_auth.as_ref() else {
        return finish_sync_failure(
            app,
            state,
            trigger,
            "GitHub App client ID is not configured".into(),
            None,
        );
    };
    let Some(sync) = state.github_sync.as_ref() else {
        return finish_sync_failure(
            app,
            state,
            trigger,
            "GitHub transport could not be initialized".into(),
            None,
        );
    };
    let access_token = match auth.access_token(&state.database).await {
        Ok(token) => token,
        Err(error) => {
            return finish_sync_failure(app, state, trigger, error.to_string(), None);
        }
    };
    match sync.refresh(&state.database, &access_token).await {
        Ok((result, transitions)) => {
            let notification_settings = state
                .settings
                .lock()
                .map_err(|_| "settings lock poisoned")?
                .current()
                .notifications
                .clone();
            if let Err(error) = deliver_transitions(
                &state.database,
                &notification_settings,
                &transitions,
                &NativeNotificationTransport::new(app.clone()),
            ) {
                record_app_error(
                    &state.database,
                    "last_notification_error",
                    &error.to_string(),
                );
            } else {
                clear_app_error(&state.database, "last_notification_error");
            }
            *state
                .last_sync
                .lock()
                .map_err(|_| "sync clock lock poisoned")? = Some(Instant::now());
            *state
                .next_sync_not_before
                .lock()
                .map_err(|_| "sync retry lock poisoned")? = None;
            clear_app_error(&state.database, "last_sync_error");
            let attention_pull_request_count = active_attention_count(state);
            refresh_attention_badges(app, attention_pull_request_count);
            let _ = app.emit(
                INBOX_SYNC_EVENT,
                InboxSyncEvent {
                    status: "completed",
                    trigger,
                    result: Some(result.clone()),
                    error: None,
                    retry_after_seconds: None,
                    attention_pull_request_count,
                },
            );
            Ok(result)
        }
        Err(error) => {
            let retry_after_seconds = match &error {
                GithubSyncError::RateLimited {
                    retry_after_seconds,
                } => Some(*retry_after_seconds),
                _ => None,
            };
            finish_sync_failure(app, state, trigger, error.to_string(), retry_after_seconds)
        }
    }
}

fn finish_sync_failure<T>(
    app: &AppHandle,
    state: &AppState,
    trigger: SyncTrigger,
    message: String,
    retry_after_seconds: Option<u64>,
) -> Result<T, String> {
    record_app_error(&state.database, "last_sync_error", &message);
    if let Ok(mut last_sync) = state.last_sync.lock() {
        *last_sync = Some(Instant::now());
    }
    if let Ok(mut not_before) = state.next_sync_not_before.lock() {
        *not_before =
            retry_after_seconds.map(|seconds| Instant::now() + Duration::from_secs(seconds));
    }
    let attention_pull_request_count = active_attention_count(state);
    refresh_attention_badges(app, attention_pull_request_count);
    let _ = app.emit(
        INBOX_SYNC_EVENT,
        InboxSyncEvent {
            status: "failed",
            trigger,
            result: None,
            error: Some(message.clone()),
            retry_after_seconds,
            attention_pull_request_count,
        },
    );
    Err(message)
}

fn record_app_error(database: &Database, key: &str, message: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let _ = database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            rusqlite::params![key, message, now],
        )?;
        Ok(())
    });
}

fn clear_app_error(database: &Database, key: &str) {
    let _ = database.with_connection(|connection| {
        connection.execute("DELETE FROM app_state WHERE key = ?1", [key])?;
        Ok(())
    });
}

fn active_attention_count(state: &AppState) -> usize {
    AttentionRepository::new(&state.database)
        .active_pull_request_count(chrono::Utc::now())
        .unwrap_or(0)
}

fn refresh_attention_badges(app: &AppHandle, count: usize) {
    let badge_count = (count > 0).then_some(count as i64);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count(badge_count);
    }
    if let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) {
        let _ = tray.set_title((count > 0).then(|| count.to_string()));
        let tooltip = if count == 0 {
            "Mission Control, inbox clear".to_owned()
        } else {
            format!(
                "Mission Control, {count} pull request{} need attention",
                if count == 1 { "" } else { "s" }
            )
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
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
            let database = Arc::new(Database::open(data_dir.join("mission-control.sqlite3"))?);
            app.manage(AppState {
                settings: Mutex::new(settings),
                database,
                agent_runtime: AgentRuntime::default(),
                logs_directory: data_dir.join("agent-runs"),
                github_auth: GithubAuthService::new().ok(),
                github_sync: GithubSyncService::new().ok(),
                sync_lock: tokio::sync::Mutex::new(()),
                last_sync: Mutex::new(None),
                next_sync_not_before: Mutex::new(None),
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
                    for (run_id, pull_request_id) in agent::stalled_runs(
                        &state.database,
                        chrono::Utc::now() - chrono::Duration::minutes(10),
                    ) {
                        activate_agent_attention(
                            &background_app,
                            &state,
                            &pull_request_id,
                            &run_id,
                            attention::AttentionReason::AgentStalled,
                            "Agent session has produced no output for ten minutes",
                        );
                    }
                    let retry_window_open = state
                        .next_sync_not_before
                        .lock()
                        .map(|not_before| {
                            not_before.is_none_or(|instant| Instant::now() >= instant)
                        })
                        .unwrap_or(false);
                    if !retry_window_open {
                        continue;
                    }
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
                    let _ = run_github_sync(&background_app, &state, SyncTrigger::Background).await;
                }
            });

            let show = MenuItem::with_id(app, "show", "Show Mission Control", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Mission Control", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id(MAIN_TRAY_ID)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let state = app.state::<AppState>();
                        if state.agent_runtime.has_active_sessions() {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        } else {
                            app.exit(0);
                        }
                    }
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
            let state = app.state::<AppState>();
            refresh_attention_badges(app.handle(), active_attention_count(&state));
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
            get_notification_permission,
            request_notification_permission,
            list_contextual_prompts,
            list_attention_items,
            list_pull_requests,
            get_pull_request_review_detail,
            mark_pull_request_seen,
            list_local_repositories,
            attach_local_repository,
            detect_agents,
            list_agent_runs,
            read_agent_run_log,
            request_copilot_review,
            reply_and_resolve,
            start_fix_session,
            open_thread_terminal,
            terminal_input,
            terminal_resize,
            terminate_agent_run,
            complete_fix_session,
            cleanup_agent_worktree,
            refresh_inbox,
            start_github_authorization,
            poll_github_authorization
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mission Control");
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn recording_an_offline_error_preserves_the_cached_inbox() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("offline.sqlite3")).unwrap();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO repositories (
                        id, owner, name, full_name, default_branch, private
                     ) VALUES ('repo-1', 'owner', 'repo', 'owner/repo', 'main', 1)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO pull_requests (
                        id, repository_id, number, title, url, author_login, head_ref,
                        head_sha, base_ref, draft, state, updated_at, last_synced_at
                     ) VALUES (
                        'pr-1', 'repo-1', 7, 'Cached PR', 'https://example.test/pr/7', 'owner',
                        'feature', 'abc123', 'main', 0, 'OPEN', '2026-08-03T12:00:00Z',
                        '2026-08-03T12:00:00Z'
                     )",
                    [],
                )?;
                Ok(())
            })
            .unwrap();

        record_app_error(&database, "last_sync_error", "network unavailable");

        let cached = list_cached_pull_requests(&database).unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].title, "Cached PR");
        let error = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT value FROM app_state WHERE key = 'last_sync_error'",
                    [],
                    |row| row.get::<_, String>(0),
                )
            })
            .unwrap();
        assert_eq!(error, "network unavailable");
    }
}
