use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};
use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::database::{Database, DatabaseError};

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const CURRENT_USER_URL: &str = "https://api.github.com/user";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_GRANT_TYPE: &str = "refresh_token";
const KEYCHAIN_SERVICE: &str = "com.leoengithub.mission-control-desktop.github";
const ACCESS_TOKEN_ACCOUNT: &str = "github.com/access-token";
const REFRESH_TOKEN_ACCOUNT: &str = "github.com/refresh-token";
const DEFAULT_GITHUB_CLIENT_ID: &str = "Iv23litFmh9lOiUlC8ua";

pub(crate) fn github_client_id() -> Option<&'static str> {
    let client_id = option_env!("MC_GITHUB_CLIENT_ID")
        .unwrap_or(DEFAULT_GITHUB_CLIENT_ID)
        .trim();
    (!client_id.is_empty()).then_some(client_id)
}

#[derive(Debug, Error)]
pub enum GithubAuthError {
    #[error("GitHub App client ID is not configured")]
    MissingClientId,
    #[error("could not initialize GitHub client: {0}")]
    Client(#[source] reqwest::Error),
    #[error("GitHub authorization request failed: {0}")]
    Request(#[source] reqwest::Error),
    #[error("GitHub authorization returned HTTP {0}")]
    Http(reqwest::StatusCode),
    #[error("GitHub authorization session was not found or has already completed")]
    SessionNotFound,
    #[error("GitHub authorization code expired; start authorization again")]
    Expired,
    #[error("GitHub authorization was denied")]
    AccessDenied,
    #[error("GitHub device flow is disabled for this GitHub App")]
    DeviceFlowDisabled,
    #[error("GitHub authorization failed: {0}")]
    Protocol(String),
    #[error("could not access the operating system credential store: {0}")]
    CredentialStore(#[source] keyring::Error),
    #[error(transparent)]
    Database(#[from] DatabaseError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthorization {
    pub session_id: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: DateTime<Utc>,
    pub poll_interval_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DeviceAuthorizationPoll {
    Pending { retry_after_seconds: u64 },
    Authorized { login: String, avatar_url: String },
}

struct PendingAuthorization {
    device_code: String,
    expires_at: Instant,
    interval: Duration,
    next_poll_at: Instant,
}

pub struct GithubAuthService {
    client: Client,
    client_id: &'static str,
    pending: Mutex<HashMap<String, PendingAuthorization>>,
}

impl GithubAuthService {
    pub fn new() -> Result<Self, GithubAuthError> {
        let client_id = github_client_id().ok_or(GithubAuthError::MissingClientId)?;
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
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(GithubAuthError::Client)?;
        Ok(Self {
            client,
            client_id,
            pending: Mutex::new(HashMap::new()),
        })
    }

    pub async fn start(&self) -> Result<DeviceAuthorization, GithubAuthError> {
        let response = self
            .client
            .post(DEVICE_CODE_URL)
            .form(&[("client_id", self.client_id)])
            .send()
            .await
            .map_err(GithubAuthError::Request)?;
        if !response.status().is_success() {
            return Err(GithubAuthError::Http(response.status()));
        }
        let response = response
            .json::<DeviceCodeResponse>()
            .await
            .map_err(GithubAuthError::Request)?;
        let session_id = Uuid::new_v4().to_string();
        let interval = Duration::from_secs(response.interval.max(1));
        let now = Instant::now();
        self.pending
            .lock()
            .map_err(|_| GithubAuthError::Protocol("authorization lock poisoned".into()))?
            .insert(
                session_id.clone(),
                PendingAuthorization {
                    device_code: response.device_code,
                    expires_at: now + Duration::from_secs(response.expires_in),
                    interval,
                    next_poll_at: now + interval,
                },
            );
        Ok(DeviceAuthorization {
            session_id,
            user_code: response.user_code,
            verification_uri: response.verification_uri,
            expires_at: Utc::now()
                + chrono::Duration::seconds(i64::try_from(response.expires_in).unwrap_or(i64::MAX)),
            poll_interval_seconds: interval.as_secs(),
        })
    }

    pub async fn poll(
        &self,
        session_id: &str,
        database: &Database,
    ) -> Result<DeviceAuthorizationPoll, GithubAuthError> {
        let device_code = {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| GithubAuthError::Protocol("authorization lock poisoned".into()))?;
            let authorization = pending
                .get_mut(session_id)
                .ok_or(GithubAuthError::SessionNotFound)?;
            let now = Instant::now();
            if now >= authorization.expires_at {
                pending.remove(session_id);
                return Err(GithubAuthError::Expired);
            }
            if now < authorization.next_poll_at {
                return Ok(DeviceAuthorizationPoll::Pending {
                    retry_after_seconds: duration_ceiling_seconds(
                        authorization.next_poll_at.duration_since(now),
                    ),
                });
            }
            authorization.next_poll_at = now + authorization.interval;
            authorization.device_code.clone()
        };

        let response = self
            .client
            .post(ACCESS_TOKEN_URL)
            .form(&[
                ("client_id", self.client_id),
                ("device_code", device_code.as_str()),
                ("grant_type", DEVICE_GRANT_TYPE),
            ])
            .send()
            .await
            .map_err(GithubAuthError::Request)?;
        if !response.status().is_success() {
            return Err(GithubAuthError::Http(response.status()));
        }
        let response = response
            .json::<AccessTokenResponse>()
            .await
            .map_err(GithubAuthError::Request)?;

        match response.disposition()? {
            TokenPollDisposition::Pending => {
                let seconds = self.poll_interval(session_id)?;
                Ok(DeviceAuthorizationPoll::Pending {
                    retry_after_seconds: seconds,
                })
            }
            TokenPollDisposition::SlowDown => {
                let seconds = self.slow_down(session_id)?;
                Ok(DeviceAuthorizationPoll::Pending {
                    retry_after_seconds: seconds,
                })
            }
            TokenPollDisposition::Authorized(token) => {
                let user = self.current_user(&token.access_token).await?;
                store_tokens(&token)?;
                save_account(database, &user, &token)?;
                self.remove_session(session_id)?;
                Ok(DeviceAuthorizationPoll::Authorized {
                    login: user.login,
                    avatar_url: user.avatar_url,
                })
            }
        }
    }

    pub async fn access_token(&self, database: &Database) -> Result<String, GithubAuthError> {
        let expires_at = database.with_connection(|connection| {
            connection.query_row(
                "SELECT access_token_expires_at FROM github_accounts \
                 WHERE needs_reauthorization = 0 ORDER BY authorized_at DESC LIMIT 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
        })?;
        let should_refresh = expires_at
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .is_some_and(|value| {
                value.with_timezone(&Utc) <= Utc::now() + chrono::Duration::minutes(5)
            });
        if !should_refresh {
            return read_token(ACCESS_TOKEN_ACCOUNT);
        }

        let refresh_token = read_token(REFRESH_TOKEN_ACCOUNT)?;
        let response = self
            .client
            .post(ACCESS_TOKEN_URL)
            .form(&[
                ("client_id", self.client_id),
                ("grant_type", REFRESH_GRANT_TYPE),
                ("refresh_token", refresh_token.as_str()),
            ])
            .send()
            .await
            .map_err(GithubAuthError::Request)?;
        if !response.status().is_success() {
            return Err(GithubAuthError::Http(response.status()));
        }
        let response = response
            .json::<AccessTokenResponse>()
            .await
            .map_err(GithubAuthError::Request)?;
        let TokenPollDisposition::Authorized(token) = response.disposition()? else {
            return Err(GithubAuthError::Protocol(
                "refresh response did not contain a token".into(),
            ));
        };
        store_tokens(&token)?;
        update_token_expiration(database, &token)?;
        Ok(token.access_token)
    }

    pub fn cancel(&self, session_id: &str) -> Result<(), GithubAuthError> {
        self.remove_session(session_id)
    }

    pub fn disconnect(&self, database: &Database) -> Result<(), GithubAuthError> {
        self.pending
            .lock()
            .map_err(|_| GithubAuthError::Protocol("authorization lock poisoned".into()))?
            .clear();
        delete_token(ACCESS_TOKEN_ACCOUNT)?;
        delete_token(REFRESH_TOKEN_ACCOUNT)?;
        clear_account_cache(database)?;
        Ok(())
    }

    fn poll_interval(&self, session_id: &str) -> Result<u64, GithubAuthError> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| GithubAuthError::Protocol("authorization lock poisoned".into()))?;
        Ok(pending
            .get(session_id)
            .ok_or(GithubAuthError::SessionNotFound)?
            .interval
            .as_secs())
    }

    fn slow_down(&self, session_id: &str) -> Result<u64, GithubAuthError> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| GithubAuthError::Protocol("authorization lock poisoned".into()))?;
        let authorization = pending
            .get_mut(session_id)
            .ok_or(GithubAuthError::SessionNotFound)?;
        authorization.interval += Duration::from_secs(5);
        authorization.next_poll_at = Instant::now() + authorization.interval;
        Ok(authorization.interval.as_secs())
    }

    fn remove_session(&self, session_id: &str) -> Result<(), GithubAuthError> {
        self.pending
            .lock()
            .map_err(|_| GithubAuthError::Protocol("authorization lock poisoned".into()))?
            .remove(session_id);
        Ok(())
    }

    async fn current_user(&self, access_token: &str) -> Result<GithubUser, GithubAuthError> {
        let response = self
            .client
            .get(CURRENT_USER_URL)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(GithubAuthError::Request)?;
        if !response.status().is_success() {
            return Err(GithubAuthError::Http(response.status()));
        }
        response
            .json::<GithubUser>()
            .await
            .map_err(GithubAuthError::Request)
    }
}

fn duration_ceiling_seconds(duration: Duration) -> u64 {
    duration.as_secs() + u64::from(duration.subsec_nanos() > 0)
}

fn store_tokens(token: &GithubToken) -> Result<(), GithubAuthError> {
    keyring::Entry::new(KEYCHAIN_SERVICE, ACCESS_TOKEN_ACCOUNT)
        .map_err(GithubAuthError::CredentialStore)?
        .set_password(&token.access_token)
        .map_err(GithubAuthError::CredentialStore)?;
    if let Some(refresh_token) = &token.refresh_token {
        keyring::Entry::new(KEYCHAIN_SERVICE, REFRESH_TOKEN_ACCOUNT)
            .map_err(GithubAuthError::CredentialStore)?
            .set_password(refresh_token)
            .map_err(GithubAuthError::CredentialStore)?;
    }
    Ok(())
}

fn read_token(account: &str) -> Result<String, GithubAuthError> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .map_err(GithubAuthError::CredentialStore)?
        .get_password()
        .map_err(GithubAuthError::CredentialStore)
}

fn delete_token(account: &str) -> Result<(), GithubAuthError> {
    let entry =
        keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(GithubAuthError::CredentialStore)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(GithubAuthError::CredentialStore(error)),
    }
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
        transaction.execute(
            "UPDATE attention_items SET cleared_at = ?1, snoozed_until = NULL \
             WHERE cleared_at IS NULL",
            [&now],
        )?;
        transaction.execute("DELETE FROM notification_deliveries", [])?;
        transaction.execute(
            "DELETE FROM app_state WHERE key IN (
                'accessible_repository_count', 'initial_sync_completed', 'last_inbox_sync_at'
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

fn update_token_expiration(database: &Database, token: &GithubToken) -> Result<(), DatabaseError> {
    let now = Utc::now();
    let access_expires_at = token
        .expires_in
        .map(|seconds| (now + chrono::Duration::seconds(seconds)).to_rfc3339());
    let refresh_expires_at = token
        .refresh_token_expires_in
        .map(|seconds| (now + chrono::Duration::seconds(seconds)).to_rfc3339());
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE github_accounts SET access_token_expires_at = ?1, \
             refresh_token_expires_at = ?2, needs_reauthorization = 0",
            rusqlite::params![access_expires_at, refresh_expires_at],
        )?;
        Ok(())
    })
}

fn save_account(
    database: &Database,
    user: &GithubUser,
    token: &GithubToken,
) -> Result<(), DatabaseError> {
    let now = Utc::now();
    let access_expires_at = token
        .expires_in
        .map(|seconds| now + chrono::Duration::seconds(seconds));
    let refresh_expires_at = token
        .refresh_token_expires_in
        .map(|seconds| now + chrono::Duration::seconds(seconds));
    database.with_connection(|connection| {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM github_accounts", [])?;
        transaction.execute(
            "INSERT INTO github_accounts (
                id, login, avatar_url, authorized_at, access_token_expires_at,
                refresh_token_expires_at, needs_reauthorization
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![
                user.id.to_string(),
                user.login,
                user.avatar_url,
                now.to_rfc3339(),
                access_expires_at.map(|value| value.to_rfc3339()),
                refresh_expires_at.map(|value| value.to_rfc3339()),
            ],
        )?;
        transaction.commit()
    })
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    expires_in: Option<i64>,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<i64>,
    error: Option<String>,
    error_description: Option<String>,
}

impl AccessTokenResponse {
    fn disposition(self) -> Result<TokenPollDisposition, GithubAuthError> {
        if let Some(access_token) = self.access_token {
            return Ok(TokenPollDisposition::Authorized(GithubToken {
                access_token,
                expires_in: self.expires_in,
                refresh_token: self.refresh_token,
                refresh_token_expires_in: self.refresh_token_expires_in,
            }));
        }
        match self.error.as_deref() {
            Some("authorization_pending") => Ok(TokenPollDisposition::Pending),
            Some("slow_down") => Ok(TokenPollDisposition::SlowDown),
            Some("expired_token" | "token_expired") => Err(GithubAuthError::Expired),
            Some("access_denied") => Err(GithubAuthError::AccessDenied),
            Some("device_flow_disabled") => Err(GithubAuthError::DeviceFlowDisabled),
            Some(error) => Err(GithubAuthError::Protocol(
                self.error_description.unwrap_or_else(|| error.to_owned()),
            )),
            None => Err(GithubAuthError::Protocol(
                "token response contained neither a token nor an error".into(),
            )),
        }
    }
}

enum TokenPollDisposition {
    Pending,
    SlowDown,
    Authorized(GithubToken),
}

struct GithubToken {
    access_token: String,
    expires_in: Option<i64>,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<i64>,
}

#[derive(Deserialize)]
struct GithubUser {
    id: u64,
    login: String,
    avatar_url: String,
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn parses_success_without_logging_token_data() {
        let response: AccessTokenResponse =
            serde_json::from_str(r#"{"access_token":"secret","token_type":"bearer","scope":""}"#)
                .unwrap();
        assert!(matches!(
            response.disposition().unwrap(),
            TokenPollDisposition::Authorized(_)
        ));
    }

    #[test]
    fn distinguishes_pending_and_slow_down() {
        for (error, expected_slow_down) in [("authorization_pending", false), ("slow_down", true)] {
            let response: AccessTokenResponse =
                serde_json::from_str(&format!(r#"{{"error":"{error}"}}"#)).unwrap();
            assert_eq!(
                matches!(
                    response.disposition().unwrap(),
                    TokenPollDisposition::SlowDown
                ),
                expected_slow_down
            );
        }
    }

    #[test]
    fn rounds_subsecond_poll_delays_up() {
        assert_eq!(duration_ceiling_seconds(Duration::from_millis(1)), 1);
        assert_eq!(duration_ceiling_seconds(Duration::from_millis(1001)), 2);
    }

    #[test]
    fn clearing_an_account_preserves_local_work_and_hides_cached_github_rows() {
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
                     );
                     INSERT INTO attention_items (
                        id, pull_request_id, reason, summary, first_detected_at, last_changed_at
                     ) VALUES (
                        'attention-1', 'pr-1', 'review_requested', 'Review requested',
                        '2026-08-04T10:00:00Z', '2026-08-04T10:00:00Z'
                     );",
                )?;
                Ok(())
            })
            .unwrap();

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
                        "SELECT cleared_at IS NOT NULL FROM attention_items WHERE id = 'attention-1'",
                        [],
                        |row| row.get::<_, bool>(0),
                    )?,
                ))
            })
            .unwrap();
        assert_eq!(state, (0, false, 1, 1, true));
    }
}
