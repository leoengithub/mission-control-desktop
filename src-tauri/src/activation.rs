use serde::Serialize;

use crate::database::{Database, DatabaseError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationStep {
    GithubAppConfigurationRequired,
    GithubAuthorizationRequired,
    RepositoryAccessRequired,
    InitialSyncRequired,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationState {
    pub step: ActivationStep,
    pub github_login: Option<String>,
    pub accessible_repository_count: u32,
    pub initial_sync_completed: bool,
}

pub fn resolve_activation_state(
    database: &Database,
    github_app_configured: bool,
) -> Result<ActivationState, DatabaseError> {
    database.with_connection(|connection| {
        let account = connection
            .query_row(
                "SELECT login FROM github_accounts ORDER BY authorized_at DESC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let repository_count = connection
            .query_row(
                "SELECT value FROM app_state WHERE key = 'accessible_repository_count'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or_else(|| {
                connection
                    .query_row("SELECT COUNT(*) FROM repositories", [], |row| {
                        row.get::<_, u32>(0)
                    })
                    .unwrap_or(0)
            });
        let initial_sync_completed = connection
            .query_row(
                "SELECT value FROM app_state WHERE key = 'initial_sync_completed'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .is_some_and(|value| value == "true");

        let step = if !github_app_configured {
            ActivationStep::GithubAppConfigurationRequired
        } else if account.is_none() {
            ActivationStep::GithubAuthorizationRequired
        } else if repository_count == 0 {
            ActivationStep::RepositoryAccessRequired
        } else if !initial_sync_completed {
            ActivationStep::InitialSyncRequired
        } else {
            ActivationStep::Ready
        };

        Ok(ActivationState {
            step,
            github_login: account,
            accessible_repository_count: repository_count,
            initial_sync_completed,
        })
    })
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn missing_build_configuration_precedes_account_state() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("activation.sqlite3")).unwrap();
        let state = resolve_activation_state(&database, false).unwrap();
        assert_eq!(state.step, ActivationStep::GithubAppConfigurationRequired);
    }

    #[test]
    fn configured_app_requires_authorization() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("activation.sqlite3")).unwrap();
        let state = resolve_activation_state(&database, true).unwrap();
        assert_eq!(state.step, ActivationStep::GithubAuthorizationRequired);
    }

    #[test]
    fn completed_sync_without_open_pull_requests_can_activate() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("activation.sqlite3")).unwrap();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO github_accounts (id, login, avatar_url, authorized_at) \
                     VALUES ('account-1', 'reviewer', '', '2026-08-03T12:00:00Z')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO app_state (key, value, updated_at) VALUES \
                     ('accessible_repository_count', '3', '2026-08-03T12:00:00Z'), \
                     ('initial_sync_completed', 'true', '2026-08-03T12:00:00Z')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();

        let state = resolve_activation_state(&database, true).unwrap();

        assert_eq!(state.step, ActivationStep::Ready);
        assert_eq!(state.accessible_repository_count, 3);
    }
}
