use std::{env, path::PathBuf, process::Command};

use chrono::Utc;
use reqwest::{Client, StatusCode, header};
use serde::Deserialize;
use thiserror::Error;
use tokio::process::Command as AsyncCommand;

use crate::database::{Database, DatabaseError};

const CURRENT_USER_URL: &str = "https://api.github.com/user";
const GITHUB_HOST: &str = "github.com";
const CONNECTION_ENABLED_KEY: &str = "github_cli_connection_enabled";
const LEGACY_KEYCHAIN_SERVICE: &str = "com.leoengithub.mission-control-desktop.github";
const LEGACY_ACCESS_TOKEN_ACCOUNT: &str = "github.com/access-token";
const LEGACY_REFRESH_TOKEN_ACCOUNT: &str = "github.com/refresh-token";

#[derive(Debug, Error)]
pub enum GithubAuthError {
    #[error("GitHub CLI was not found. Install gh from https://cli.github.com, then try again.")]
    CliUnavailable,
    #[error("GitHub CLI is not signed in. Run `gh auth login` in Terminal, then try again.")]
    NotAuthenticated,
    #[error("Mission Control is disconnected from GitHub CLI")]
    Disconnected,
    #[error("could not run GitHub CLI: {0}")]
    Execution(#[source] std::io::Error),
    #[error("GitHub CLI command failed: {0}")]
    Command(String),
    #[error("GitHub CLI returned an invalid response: {0}")]
    InvalidResponse(#[from] serde_json::Error),
    #[error("GitHub request failed: {0}")]
    Request(#[source] reqwest::Error),
    #[error("GitHub returned HTTP {0}")]
    Http(StatusCode),
    #[error(
        "Only one GitHub CLI account is available. Add another with `gh auth login`, then try again."
    )]
    NoAlternateAccount,
    #[error(
        "More than two GitHub CLI accounts are available. Run `gh auth switch` in Terminal to choose one, then refresh Mission Control."
    )]
    AmbiguousAlternateAccount,
    #[error(transparent)]
    Database(#[from] DatabaseError),
}

pub struct GithubAuthService {
    client: Client,
}

impl GithubAuthService {
    pub fn new() -> Result<Self, GithubAuthError> {
        clear_legacy_credentials();
        let client = Client::builder()
            .user_agent(concat!(
                "mission-control-desktop/",
                env!("CARGO_PKG_VERSION")
            ))
            .default_headers(header::HeaderMap::from_iter([
                (
                    header::ACCEPT,
                    header::HeaderValue::from_static("application/vnd.github+json"),
                ),
                (
                    header::HeaderName::from_static("x-github-api-version"),
                    header::HeaderValue::from_static("2026-03-10"),
                ),
            ]))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(GithubAuthError::Request)?;
        Ok(Self { client })
    }

    pub fn is_available(&self) -> bool {
        resolve_gh_binary().is_some()
    }

    pub async fn reconcile(&self, database: &Database) -> Result<(), GithubAuthError> {
        if !connection_enabled(database)? {
            return Ok(());
        }
        match self.access_token(database).await {
            Ok(_) => Ok(()),
            Err(GithubAuthError::CliUnavailable | GithubAuthError::NotAuthenticated) => {
                clear_account_cache_if_present(database)?;
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    pub async fn connect(&self, database: &Database) -> Result<(), GithubAuthError> {
        set_connection_enabled(database, true)?;
        self.access_token(database).await.map(|_| ())
    }

    pub async fn access_token(&self, database: &Database) -> Result<String, GithubAuthError> {
        if !connection_enabled(database)? {
            return Err(GithubAuthError::Disconnected);
        }
        let binary = resolve_gh_binary().ok_or(GithubAuthError::CliUnavailable)?;
        let output = AsyncCommand::new(binary)
            .args(["auth", "token", "--hostname", GITHUB_HOST])
            .output()
            .await
            .map_err(GithubAuthError::Execution)?;
        if !output.status.success() {
            return Err(GithubAuthError::NotAuthenticated);
        }
        let token = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if token.is_empty() {
            return Err(GithubAuthError::NotAuthenticated);
        }
        let user = self.current_user(&token).await?;
        reconcile_account(database, &user)?;
        Ok(token)
    }

    pub fn disconnect(&self, database: &Database) -> Result<(), GithubAuthError> {
        set_connection_enabled(database, false)?;
        clear_account_cache(database)?;
        Ok(())
    }

    pub async fn switch_account(&self, database: &Database) -> Result<(), GithubAuthError> {
        let binary = resolve_gh_binary().ok_or(GithubAuthError::CliUnavailable)?;
        let status = AsyncCommand::new(&binary)
            .args(["auth", "status", "--json", "hosts"])
            .output()
            .await
            .map_err(GithubAuthError::Execution)?;
        if !status.status.success() {
            return Err(GithubAuthError::NotAuthenticated);
        }
        let parsed: GithubAuthStatus = serde_json::from_slice(&status.stdout)?;
        let accounts = parsed
            .hosts
            .github_com
            .into_iter()
            .filter(|account| account.state == "success")
            .collect::<Vec<_>>();
        if accounts.len() < 2 {
            return Err(GithubAuthError::NoAlternateAccount);
        }
        if accounts.len() > 2 {
            return Err(GithubAuthError::AmbiguousAlternateAccount);
        }
        let target = accounts
            .iter()
            .find(|account| !account.active)
            .ok_or(GithubAuthError::NoAlternateAccount)?;
        let switched = AsyncCommand::new(binary)
            .args([
                "auth",
                "switch",
                "--hostname",
                GITHUB_HOST,
                "--user",
                target.login.as_str(),
            ])
            .output()
            .await
            .map_err(GithubAuthError::Execution)?;
        if !switched.status.success() {
            return Err(GithubAuthError::Command(command_error(&switched.stderr)));
        }
        set_connection_enabled(database, true)?;
        clear_account_cache(database)?;
        self.access_token(database).await.map(|_| ())
    }

    async fn current_user(&self, access_token: &str) -> Result<GithubUser, GithubAuthError> {
        let response = self
            .client
            .get(CURRENT_USER_URL)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(GithubAuthError::Request)?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(GithubAuthError::NotAuthenticated);
        }
        if !response.status().is_success() {
            return Err(GithubAuthError::Http(response.status()));
        }
        response
            .json::<GithubUser>()
            .await
            .map_err(GithubAuthError::Request)
    }
}

fn resolve_gh_binary() -> Option<PathBuf> {
    if let Some(configured) = env::var_os("MC_GH_PATH") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(path) = env::var_os("PATH").and_then(|value| {
        env::split_paths(&value)
            .map(|directory| directory.join("gh"))
            .find(|candidate| candidate.is_file())
    }) {
        return Some(path);
    }
    for candidate in [
        "/opt/homebrew/bin/gh",
        "/usr/local/bin/gh",
        "/home/linuxbrew/.linuxbrew/bin/gh",
    ] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    resolve_gh_from_login_shell()
}

fn resolve_gh_from_login_shell() -> Option<PathBuf> {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let output = Command::new(shell)
        .args(["-lc", "command -v gh"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    path.is_file().then_some(path)
}

fn connection_enabled(database: &Database) -> Result<bool, DatabaseError> {
    database.with_connection(|connection| {
        let value = connection
            .query_row(
                "SELECT value FROM app_state WHERE key = ?1",
                [CONNECTION_ENABLED_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value.as_deref() != Some("false"))
    })
}

fn set_connection_enabled(database: &Database, enabled: bool) -> Result<(), DatabaseError> {
    let now = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            rusqlite::params![
                CONNECTION_ENABLED_KEY,
                if enabled { "true" } else { "false" },
                now
            ],
        )?;
        Ok(())
    })
}

fn reconcile_account(database: &Database, user: &GithubUser) -> Result<(), DatabaseError> {
    let existing = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT login FROM github_accounts ORDER BY authorized_at DESC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
    })?;
    if existing.as_deref() != Some(user.login.as_str()) {
        clear_account_cache(database)?;
        save_account(database, user)?;
    }
    Ok(())
}

fn save_account(database: &Database, user: &GithubUser) -> Result<(), DatabaseError> {
    let now = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        connection.execute("DELETE FROM github_accounts", [])?;
        connection.execute(
            "INSERT INTO github_accounts (
                id, login, avatar_url, authorized_at, access_token_expires_at,
                refresh_token_expires_at, needs_reauthorization
             ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 0)",
            rusqlite::params![user.id.to_string(), user.login, user.avatar_url, now],
        )?;
        Ok(())
    })
}

fn clear_account_cache_if_present(database: &Database) -> Result<(), DatabaseError> {
    let has_account = database.with_connection(|connection| {
        connection.query_row("SELECT EXISTS(SELECT 1 FROM github_accounts)", [], |row| {
            row.get::<_, bool>(0)
        })
    })?;
    if has_account {
        clear_account_cache(database)?;
    }
    Ok(())
}

fn clear_account_cache(database: &Database) -> Result<(), DatabaseError> {
    let now = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM github_accounts", [])?;
        transaction.execute(
            "UPDATE pull_requests SET in_scope = 0, review_requested = 0",
            [],
        )?;
        transaction.execute("UPDATE repositories SET accessible = 0, monitored = 0", [])?;
        transaction.execute(
            "UPDATE attention_items SET cleared_at = ?1, snoozed_until = NULL \
             WHERE cleared_at IS NULL",
            [&now],
        )?;
        transaction.execute("DELETE FROM notification_deliveries", [])?;
        transaction.execute(
            "DELETE FROM app_state WHERE key IN (
                'accessible_repository_count', 'repository_selection_completed',
                'initial_sync_completed', 'last_inbox_sync_at'
             )",
            [],
        )?;
        for (key, value) in [
            ("accessible_repository_count", "0"),
            ("initial_sync_completed", "false"),
        ] {
            transaction.execute(
                "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![key, value, now],
            )?;
        }
        transaction.commit()
    })?;
    Ok(())
}

fn clear_legacy_credentials() {
    for account in [LEGACY_ACCESS_TOKEN_ACCOUNT, LEGACY_REFRESH_TOKEN_ACCOUNT] {
        if let Ok(entry) = keyring::Entry::new(LEGACY_KEYCHAIN_SERVICE, account) {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => {}
            }
        }
    }
}

fn command_error(stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_owned();
    if message.is_empty() {
        "command exited unsuccessfully".into()
    } else {
        message
    }
}

#[derive(Deserialize)]
struct GithubUser {
    id: u64,
    login: String,
    avatar_url: String,
}

#[derive(Deserialize)]
struct GithubAuthStatus {
    hosts: GithubAuthHosts,
}

#[derive(Deserialize)]
struct GithubAuthHosts {
    #[serde(rename = "github.com", default)]
    github_com: Vec<GithubCliAccount>,
}

#[derive(Deserialize)]
struct GithubCliAccount {
    state: String,
    active: bool,
    login: String,
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn github_cli_status_parses_active_and_alternate_accounts() {
        let status: GithubAuthStatus = serde_json::from_str(
            r#"{"hosts":{"github.com":[{"state":"success","active":true,"login":"leo"},{"state":"success","active":false,"login":"lucas"}]}}"#,
        )
        .unwrap();
        assert_eq!(status.hosts.github_com.len(), 2);
        assert_eq!(status.hosts.github_com[0].login, "leo");
        assert!(status.hosts.github_com[0].active);
    }

    #[test]
    fn disconnecting_preserves_github_cli_and_local_work() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("account.sqlite3")).unwrap();
        database
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO github_accounts (id, login, avatar_url, authorized_at)
                     VALUES ('account-1', 'reviewer', '', '2026-08-04T10:00:00Z');
                     INSERT INTO repositories (
                        id, owner, name, full_name, default_branch, private
                     ) VALUES ('repo-1', 'owner', 'repo', 'owner/repo', 'main', 1);
                     INSERT INTO pull_requests (
                        id, repository_id, number, title, url, author_login, head_ref,
                        head_sha, base_ref, draft, review_requested, in_scope, state,
                        updated_at, last_synced_at
                     ) VALUES (
                        'pr-1', 'repo-1', 1, 'Review me', 'https://github.com/owner/repo/pull/1',
                        'reviewer', 'feature', 'abc123', 'main', 0, 1, 1, 'OPEN',
                        '2026-08-04T10:00:00Z', '2026-08-04T10:00:00Z'
                     );
                     INSERT INTO local_repositories (
                        repository_id, local_path, default_branch, validation_state,
                        last_validated_at
                     ) VALUES ('repo-1', '/tmp/repo', 'main', 'valid', '2026-08-04T10:00:00Z');
                     INSERT INTO agent_runs (
                        id, pull_request_id, agent, status, worktree_path, log_path, started_at
                     ) VALUES (
                        'run-1', 'pr-1', 'codex', 'completed', '/tmp/worktree',
                        '/tmp/run.log', '2026-08-04T10:00:00Z'
                     );",
                )?;
                Ok(())
            })
            .unwrap();

        set_connection_enabled(&database, false).unwrap();
        clear_account_cache(&database).unwrap();

        let state = database
            .with_connection(|connection| {
                Ok((
                    connection.query_row("SELECT COUNT(*) FROM github_accounts", [], |row| {
                        row.get::<_, u32>(0)
                    })?,
                    connection.query_row(
                        "SELECT in_scope FROM pull_requests WHERE id = 'pr-1'",
                        [],
                        |row| row.get::<_, bool>(0),
                    )?,
                    connection.query_row("SELECT COUNT(*) FROM local_repositories", [], |row| {
                        row.get::<_, u32>(0)
                    })?,
                    connection.query_row("SELECT COUNT(*) FROM agent_runs", [], |row| {
                        row.get::<_, u32>(0)
                    })?,
                    connection.query_row(
                        "SELECT value FROM app_state WHERE key = ?1",
                        [CONNECTION_ENABLED_KEY],
                        |row| row.get::<_, String>(0),
                    )?,
                ))
            })
            .unwrap();
        assert_eq!(state, (0, false, 1, 1, "false".into()));
    }
}
