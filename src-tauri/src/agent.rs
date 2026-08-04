use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::Utc;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use rusqlite::{OptionalExtension, params};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::process::Command as AsyncCommand;
use uuid::Uuid;

use crate::{
    attention::{AttentionCandidate, AttentionReason, AttentionRepository},
    database::{Database, DatabaseError},
    notifications::{NativeNotificationTransport, deliver_transitions},
    settings::{AgentKind, AppSettings},
};

pub const TERMINAL_EVENT: &str = "mission-control://terminal";

#[derive(Debug, Error)]
pub enum AgentError {
    #[error(transparent)]
    Database(#[from] DatabaseError),
    #[error("could not create agent log directory: {0}")]
    CreateLogDirectory(#[source] std::io::Error),
    #[error("could not start terminal: {0}")]
    Terminal(String),
    #[error("agent executable was not found: {0}")]
    AgentUnavailable(String),
    #[error("agent execution failed: {0}")]
    Execution(String),
    #[error("agent execution timed out after five minutes")]
    Timeout,
    #[error("terminal session is no longer active")]
    SessionUnavailable,
    #[error("terminal input lock poisoned")]
    LockPoisoned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentAction {
    ReplyResolve,
    FixReplyResolve,
    OpenTerminal,
}

impl AgentAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReplyResolve => "reply_resolve",
            Self::FixReplyResolve => "fix_reply_resolve",
            Self::OpenTerminal => "open_terminal",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub id: String,
    pub pull_request_id: String,
    pub thread_id: Option<String>,
    pub action: String,
    pub agent: String,
    pub status: String,
    pub worktree_path: Option<String>,
    pub base_head_sha: Option<String>,
    pub log_path: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub summary: Option<String>,
    pub exit_code: Option<i64>,
    pub reply_posted_at: Option<String>,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAvailability {
    pub agent: AgentKind,
    pub label: &'static str,
    pub available: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalEvent {
    run_id: String,
    kind: &'static str,
    data: Option<String>,
    status: Option<String>,
    exit_code: Option<i32>,
}

struct TerminalSession {
    working_directory: PathBuf,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

pub(crate) struct TerminalStartRequest<'a> {
    pub app: AppHandle,
    pub database: Arc<Database>,
    pub logs_directory: &'a Path,
    pub pull_request_id: &'a str,
    pub thread_id: Option<&'a str>,
    pub action: AgentAction,
    pub agent: Option<AgentKind>,
    pub working_directory: &'a Path,
    pub prompt: Option<String>,
    pub base_head_sha: Option<&'a str>,
    pub settings: &'a AppSettings,
}

#[derive(Clone, Default)]
pub struct AgentRuntime {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
    stop_reasons: Arc<Mutex<HashMap<String, String>>>,
}

impl AgentRuntime {
    pub fn start_terminal(
        &self,
        request: TerminalStartRequest<'_>,
    ) -> Result<AgentRun, AgentError> {
        let TerminalStartRequest {
            app,
            database,
            logs_directory,
            pull_request_id,
            thread_id,
            action,
            agent,
            working_directory,
            prompt,
            base_head_sha,
            settings,
        } = request;
        if self
            .sessions
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?
            .values()
            .any(|session| session.working_directory == working_directory)
        {
            return Err(AgentError::Terminal(
                "this worktree already has an active terminal session".into(),
            ));
        }
        fs::create_dir_all(logs_directory).map_err(AgentError::CreateLogDirectory)?;
        let run_id = Uuid::new_v4().to_string();
        let log_path = logs_directory.join(format!("{run_id}.log"));
        let (binary, arguments, prompt_via_input) = terminal_command(agent, settings)?;
        let mut command = CommandBuilder::new(binary);
        arguments.iter().for_each(|argument| {
            command.arg(argument);
        });
        command.cwd(working_directory);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 32,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AgentError::Terminal(error.to_string()))?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| AgentError::Terminal(error.to_string()))?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| AgentError::Terminal(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| AgentError::Terminal(error.to_string()))?;
        let session = Arc::new(TerminalSession {
            working_directory: working_directory.to_owned(),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(child.clone_killer()),
        });
        self.sessions
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?
            .insert(run_id.clone(), session.clone());

        let started_at = Utc::now().to_rfc3339();
        let run = AgentRun {
            id: run_id.clone(),
            pull_request_id: pull_request_id.into(),
            thread_id: thread_id.map(str::to_owned),
            action: action.as_str().into(),
            agent: agent.map_or_else(|| "shell".into(), agent_name),
            status: "running".into(),
            worktree_path: Some(working_directory.to_string_lossy().to_string()),
            base_head_sha: base_head_sha.map(str::to_owned),
            log_path: Some(log_path.to_string_lossy().to_string()),
            started_at: started_at.clone(),
            ended_at: None,
            summary: None,
            exit_code: None,
            reply_posted_at: None,
            resolved_at: None,
        };
        insert_run(&database, &run)?;

        let read_runtime = self.clone();
        let read_run_id = run_id.clone();
        let read_database = database.clone();
        let read_app = app.clone();
        let read_log_path = log_path.clone();
        let read_pull_request_id = pull_request_id.to_owned();
        std::thread::spawn(move || {
            stream_terminal_output(
                reader,
                &read_log_path,
                &read_run_id,
                &read_pull_request_id,
                &read_app,
                &read_database,
            );
            drop(read_runtime);
        });

        let wait_runtime = self.clone();
        let wait_run_id = run_id.clone();
        let wait_database = database;
        let wait_pull_request_id = pull_request_id.to_owned();
        let notification_settings = settings.notifications.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            let exit_code = status.as_ref().ok().map(|status| status.exit_code() as i32);
            let stop_reason = wait_runtime
                .stop_reasons
                .lock()
                .ok()
                .and_then(|mut reasons| reasons.remove(&wait_run_id));
            let (run_status, summary) = if let Some(reason) = stop_reason {
                ("interrupted", Some(reason))
            } else if status.as_ref().is_ok_and(|status| status.success()) {
                ("completed", None)
            } else {
                (
                    "failed",
                    Some("Terminal process exited unsuccessfully".into()),
                )
            };
            let _ = update_run_exit(
                &wait_database,
                &wait_run_id,
                run_status,
                exit_code,
                summary.as_deref(),
            );
            if let Ok(mut sessions) = wait_runtime.sessions.lock() {
                sessions.remove(&wait_run_id);
            }
            let _ = AttentionRepository::new(&wait_database).clear_candidate(
                &wait_pull_request_id,
                AttentionReason::AgentStalled,
                Some(&wait_run_id),
                Utc::now(),
            );
            let attention = match (run_status, action) {
                ("interrupted", _) => Some((
                    AttentionReason::AgentInterrupted,
                    "Agent session was interrupted",
                )),
                ("failed", _) => Some((AttentionReason::AgentFailed, "Agent session failed")),
                ("completed", AgentAction::FixReplyResolve) => Some((
                    AttentionReason::AgentWaitingForUser,
                    "Agent fix is ready for review and completion",
                )),
                _ => None,
            };
            if let Some((reason, summary)) = attention
                && let Ok(Some(transition)) = AttentionRepository::new(&wait_database)
                    .activate_candidate(
                        &wait_pull_request_id,
                        AttentionCandidate {
                            reason,
                            source_id: Some(wait_run_id.clone()),
                            summary: summary.into(),
                        },
                        Utc::now(),
                    )
            {
                let _ = deliver_transitions(
                    &wait_database,
                    &notification_settings,
                    &[transition],
                    &NativeNotificationTransport::new(app.clone()),
                );
                let count = AttentionRepository::new(&wait_database)
                    .active_pull_request_count(Utc::now())
                    .unwrap_or(0);
                crate::refresh_attention_badges(&app, count);
            } else {
                let count = AttentionRepository::new(&wait_database)
                    .active_pull_request_count(Utc::now())
                    .unwrap_or(0);
                crate::refresh_attention_badges(&app, count);
            }
            let _ = app.emit(
                TERMINAL_EVENT,
                TerminalEvent {
                    run_id: wait_run_id,
                    kind: "exit",
                    data: None,
                    status: Some(run_status.into()),
                    exit_code,
                },
            );
        });

        if prompt_via_input && let Some(prompt) = prompt {
            let prompt_session = session;
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1200));
                if let Ok(mut writer) = prompt_session.writer.lock() {
                    let _ = writer.write_all(format!("{prompt}\r").as_bytes());
                    let _ = writer.flush();
                }
            });
        }
        Ok(run)
    }

    pub fn write(&self, run_id: &str, data: &str) -> Result<(), AgentError> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?
            .get(run_id)
            .cloned()
            .ok_or(AgentError::SessionUnavailable)?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|error| AgentError::Terminal(error.to_string()))
    }

    pub fn resize(&self, run_id: &str, cols: u16, rows: u16) -> Result<(), AgentError> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?
            .get(run_id)
            .cloned()
            .ok_or(AgentError::SessionUnavailable)?;
        session
            .master
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AgentError::Terminal(error.to_string()))
    }

    pub fn terminate(&self, run_id: &str) -> Result<(), AgentError> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?
            .get(run_id)
            .cloned()
            .ok_or(AgentError::SessionUnavailable)?;
        self.stop_reasons
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?
            .insert(run_id.into(), "Stopped by the user".into());
        session
            .killer
            .lock()
            .map_err(|_| AgentError::LockPoisoned)?
            .kill()
            .map_err(|error| AgentError::Terminal(error.to_string()))
    }

    pub fn is_active(&self, run_id: &str) -> bool {
        self.sessions
            .lock()
            .is_ok_and(|sessions| sessions.contains_key(run_id))
    }

    pub fn has_active_sessions(&self) -> bool {
        self.sessions
            .lock()
            .is_ok_and(|sessions| !sessions.is_empty())
    }
}

pub async fn run_agent_reply(
    agent: AgentKind,
    prompt: &str,
    working_directory: &Path,
    settings: &AppSettings,
) -> Result<String, AgentError> {
    let (binary, arguments) = print_command(agent, settings);
    if !binary_available(&binary) {
        return Err(AgentError::AgentUnavailable(binary));
    }
    let mut command = AsyncCommand::new(&binary);
    command
        .args(arguments)
        .arg(prompt)
        .current_dir(working_directory)
        .env("NO_COLOR", "1")
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(300), command.output())
        .await
        .map_err(|_| AgentError::Timeout)?
        .map_err(|error| AgentError::Execution(error.to_string()))?;
    if !output.status.success() {
        return Err(AgentError::Execution(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let reply = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if reply.is_empty() {
        return Err(AgentError::Execution(
            "agent returned an empty reply".into(),
        ));
    }
    Ok(reply)
}

pub fn detect_agents() -> Vec<AgentAvailability> {
    [
        (AgentKind::Codex, "Codex", "codex"),
        (AgentKind::ClaudeCode, "Claude Code", "claude"),
    ]
    .into_iter()
    .map(|(agent, label, binary)| {
        let output = Command::new(binary).arg("--version").output().ok();
        let available = output
            .as_ref()
            .is_some_and(|output| output.status.success());
        let version = output.and_then(|output| {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            (!value.is_empty()).then_some(value)
        });
        AgentAvailability {
            agent,
            label,
            available,
            version,
        }
    })
    .collect()
}

pub fn list_runs(database: &Database, pull_request_id: &str) -> Result<Vec<AgentRun>, AgentError> {
    database
        .with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, pull_request_id, thread_id, action, agent, status, worktree_path,
                 base_head_sha, log_path, started_at, ended_at, summary, exit_code,
                 reply_posted_at, resolved_at
                 FROM agent_runs WHERE pull_request_id = ?1 ORDER BY started_at DESC",
            )?;
            statement
                .query_map([pull_request_id], map_run)?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(AgentError::Database)
}

pub fn get_run(database: &Database, run_id: &str) -> Result<AgentRun, AgentError> {
    database
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, pull_request_id, thread_id, action, agent, status, worktree_path,
                     base_head_sha, log_path, started_at, ended_at, summary, exit_code,
                     reply_posted_at, resolved_at
                     FROM agent_runs WHERE id = ?1",
                    [run_id],
                    map_run,
                )
                .optional()
        })?
        .ok_or(AgentError::SessionUnavailable)
}

pub fn read_run_log(database: &Database, run_id: &str) -> Result<String, AgentError> {
    let run = get_run(database, run_id)?;
    let Some(path) = run.log_path else {
        return Ok(String::new());
    };
    fs::read_to_string(path).map_err(|error| AgentError::Execution(error.to_string()))
}

pub fn stalled_runs(
    database: &Database,
    threshold: chrono::DateTime<Utc>,
) -> Vec<(String, String)> {
    database
        .with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, pull_request_id FROM agent_runs WHERE status = 'running' \
                 AND COALESCE(last_output_at, started_at) < ?1",
            )?;
            statement
                .query_map([threshold.to_rfc3339()], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap_or_default()
}

pub fn create_noninteractive_run(
    database: &Database,
    pull_request_id: &str,
    thread_id: &str,
    agent: AgentKind,
    working_directory: &Path,
) -> Result<AgentRun, AgentError> {
    let run = AgentRun {
        id: Uuid::new_v4().to_string(),
        pull_request_id: pull_request_id.into(),
        thread_id: Some(thread_id.into()),
        action: AgentAction::ReplyResolve.as_str().into(),
        agent: agent_name(agent),
        status: "running".into(),
        worktree_path: Some(working_directory.to_string_lossy().to_string()),
        base_head_sha: None,
        log_path: None,
        started_at: Utc::now().to_rfc3339(),
        ended_at: None,
        summary: None,
        exit_code: None,
        reply_posted_at: None,
        resolved_at: None,
    };
    insert_run(database, &run)?;
    Ok(run)
}

pub fn update_run_status(
    database: &Database,
    run_id: &str,
    status: &str,
    summary: Option<&str>,
) -> Result<(), AgentError> {
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE agent_runs SET status = ?1, summary = ?2, ended_at = ?3 WHERE id = ?4",
            params![status, summary, Utc::now().to_rfc3339(), run_id],
        )?;
        Ok(())
    })?;
    Ok(())
}

pub fn restart_run(database: &Database, run_id: &str) -> Result<(), AgentError> {
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE agent_runs SET status = 'running', ended_at = NULL, summary = NULL \
             WHERE id = ?1",
            [run_id],
        )?;
        Ok(())
    })?;
    Ok(())
}

pub fn mark_reply_posted(database: &Database, run_id: &str) -> Result<(), AgentError> {
    mark_checkpoint(database, run_id, "reply_posted_at")
}

pub fn mark_resolved(database: &Database, run_id: &str) -> Result<(), AgentError> {
    mark_checkpoint(database, run_id, "resolved_at")
}

fn mark_checkpoint(database: &Database, run_id: &str, column: &str) -> Result<(), AgentError> {
    let sql = format!("UPDATE agent_runs SET {column} = ?1 WHERE id = ?2");
    database.with_connection(|connection| {
        connection.execute(&sql, params![Utc::now().to_rfc3339(), run_id])?;
        Ok(())
    })?;
    Ok(())
}

fn insert_run(database: &Database, run: &AgentRun) -> Result<(), AgentError> {
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO agent_runs (
                id, pull_request_id, thread_id, action, agent, status, worktree_path,
                base_head_sha, log_path, started_at, ended_at, summary, exit_code,
                reply_posted_at, resolved_at,
                last_output_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?10)",
            params![
                run.id,
                run.pull_request_id,
                run.thread_id,
                run.action,
                run.agent,
                run.status,
                run.worktree_path,
                run.base_head_sha,
                run.log_path,
                run.started_at,
                run.ended_at,
                run.summary,
                run.exit_code,
                run.reply_posted_at,
                run.resolved_at,
            ],
        )?;
        Ok(())
    })?;
    Ok(())
}

fn update_run_exit(
    database: &Database,
    run_id: &str,
    status: &str,
    exit_code: Option<i32>,
    summary: Option<&str>,
) -> Result<(), AgentError> {
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE agent_runs SET status = ?1, exit_code = ?2, summary = ?3, ended_at = ?4 \
             WHERE id = ?5",
            params![status, exit_code, summary, Utc::now().to_rfc3339(), run_id],
        )?;
        Ok(())
    })?;
    Ok(())
}

fn stream_terminal_output(
    mut reader: Box<dyn Read + Send>,
    log_path: &Path,
    run_id: &str,
    pull_request_id: &str,
    app: &AppHandle,
    database: &Database,
) {
    let Ok(mut log) = OpenOptions::new().create(true).append(true).open(log_path) else {
        return;
    };
    let mut buffer = [0_u8; 8192];
    while let Ok(read) = reader.read(&mut buffer) {
        if read == 0 {
            break;
        }
        let _ = log.write_all(&buffer[..read]);
        let chunk = String::from_utf8_lossy(&buffer[..read]).to_string();
        let now = Utc::now().to_rfc3339();
        let _ = database.with_connection(|connection| {
            connection.execute(
                "UPDATE agent_runs SET last_output_at = ?1 WHERE id = ?2",
                params![now, run_id],
            )?;
            Ok(())
        });
        if AttentionRepository::new(database)
            .clear_candidate(
                pull_request_id,
                AttentionReason::AgentStalled,
                Some(run_id),
                Utc::now(),
            )
            .ok()
            .flatten()
            .is_some()
        {
            let count = AttentionRepository::new(database)
                .active_pull_request_count(Utc::now())
                .unwrap_or(0);
            crate::refresh_attention_badges(app, count);
        }
        let _ = app.emit(
            TERMINAL_EVENT,
            TerminalEvent {
                run_id: run_id.into(),
                kind: "output",
                data: Some(chunk),
                status: Some("running".into()),
                exit_code: None,
            },
        );
    }
}

fn terminal_command(
    agent: Option<AgentKind>,
    settings: &AppSettings,
) -> Result<(String, Vec<String>, bool), AgentError> {
    let Some(agent) = agent else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        return Ok((shell, vec!["-l".into()], false));
    };
    let (binary, mut arguments) = match agent {
        AgentKind::Codex => ("codex".to_owned(), Vec::new()),
        AgentKind::ClaudeCode => ("claude".to_owned(), Vec::new()),
    };
    if !binary_available(&binary) {
        return Err(AgentError::AgentUnavailable(binary));
    }
    match agent {
        AgentKind::Codex if settings.agents.codex_permission_bypass => {
            arguments.push("--dangerously-bypass-approvals-and-sandbox".into());
        }
        AgentKind::ClaudeCode if settings.agents.claude_permission_bypass => {
            arguments.push("--dangerously-skip-permissions".into());
        }
        _ => {}
    }
    Ok((binary, arguments, true))
}

fn print_command(agent: AgentKind, _settings: &AppSettings) -> (String, Vec<String>) {
    match agent {
        AgentKind::Codex => (
            "codex".into(),
            vec![
                "exec".into(),
                "--skip-git-repo-check".into(),
                "--sandbox".into(),
                "read-only".into(),
            ],
        ),
        AgentKind::ClaudeCode => (
            "claude".into(),
            vec!["-p".into(), "--output-format".into(), "text".into()],
        ),
    }
}

fn binary_available(binary: &str) -> bool {
    Command::new(binary)
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success())
}

fn agent_name(agent: AgentKind) -> String {
    match agent {
        AgentKind::Codex => "codex",
        AgentKind::ClaudeCode => "claude_code",
    }
    .into()
}

fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRun> {
    Ok(AgentRun {
        id: row.get(0)?,
        pull_request_id: row.get(1)?,
        thread_id: row.get(2)?,
        action: row.get(3)?,
        agent: row.get(4)?,
        status: row.get(5)?,
        worktree_path: row.get(6)?,
        base_head_sha: row.get(7)?,
        log_path: row.get(8)?,
        started_at: row.get(9)?,
        ended_at: row.get(10)?,
        summary: row.get(11)?,
        exit_code: row.get(12)?,
        reply_posted_at: row.get(13)?,
        resolved_at: row.get(14)?,
    })
}
