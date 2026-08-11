use std::{fs, path::PathBuf, sync::Mutex};

use rusqlite::{Connection, OpenFlags};
use thiserror::Error;

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
const REVIEW_WORKFLOWS_MIGRATION: &str = include_str!("../migrations/0002_review_workflows.sql");
const REPOSITORY_MONITORING_MIGRATION: &str =
    include_str!("../migrations/0003_repository_monitoring.sql");
const PULL_REQUEST_READINESS_MIGRATION: &str =
    include_str!("../migrations/0004_pull_request_readiness.sql");
const PULL_REQUEST_OVERVIEW_MIGRATION: &str =
    include_str!("../migrations/0005_pull_request_overview.sql");

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("could not create application data directory: {0}")]
    CreateDirectory(#[source] std::io::Error),
    #[error("database operation failed: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("database lock poisoned")]
    LockPoisoned,
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, DatabaseError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(DatabaseError::CreateDirectory)?;
        }
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
        )?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let mut version =
            connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
        if version == 0 {
            connection.execute_batch(INITIAL_MIGRATION)?;
            version = 1;
        }
        if version == 1 {
            connection.execute_batch(REVIEW_WORKFLOWS_MIGRATION)?;
            version = 2;
        }
        if version == 2 {
            connection.execute_batch(REPOSITORY_MONITORING_MIGRATION)?;
            version = 3;
        }
        if version == 3 {
            connection.execute_batch(PULL_REQUEST_READINESS_MIGRATION)?;
            version = 4;
        }
        if version == 4 {
            connection.execute_batch(PULL_REQUEST_OVERVIEW_MIGRATION)?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, DatabaseError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)?;
        operation(&connection).map_err(DatabaseError::Sql)
    }

    pub fn verify(&self) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            connection.query_row("PRAGMA user_version", [], |_| Ok(()))
        })
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn creates_versioned_schema() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("test.sqlite3")).unwrap();
        let version = database
            .with_connection(|connection| {
                connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            })
            .unwrap();
        assert_eq!(version, 5);
        let columns = database
            .with_connection(|connection| {
                let mut statement = connection.prepare("PRAGMA table_info(agent_runs)")?;
                statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap();
        assert!(columns.iter().any(|column| column == "thread_id"));
        let repository_columns = database
            .with_connection(|connection| {
                let mut statement = connection.prepare("PRAGMA table_info(repositories)")?;
                statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap();
        assert!(
            repository_columns
                .iter()
                .any(|column| column == "monitored")
        );
        assert!(
            repository_columns
                .iter()
                .any(|column| column == "accessible")
        );
        let pull_request_columns = database
            .with_connection(|connection| {
                let mut statement = connection.prepare("PRAGMA table_info(pull_requests)")?;
                statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap();
        assert!(
            pull_request_columns
                .iter()
                .any(|column| column == "merge_state_status")
        );
        assert!(
            pull_request_columns
                .iter()
                .any(|column| column == "review_decision")
        );
        for column in ["body_text", "changed_files", "additions", "deletions"] {
            assert!(
                pull_request_columns
                    .iter()
                    .any(|candidate| candidate == column),
                "missing pull request overview column {column}"
            );
        }
    }

    #[test]
    fn overview_migration_preserves_existing_pull_requests_with_safe_defaults() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("version-four.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(INITIAL_MIGRATION).unwrap();
        connection
            .execute_batch(REVIEW_WORKFLOWS_MIGRATION)
            .unwrap();
        connection
            .execute_batch(REPOSITORY_MONITORING_MIGRATION)
            .unwrap();
        connection
            .execute_batch(PULL_REQUEST_READINESS_MIGRATION)
            .unwrap();
        connection
            .execute(
                "INSERT INTO repositories (
                    id, owner, name, full_name, default_branch, private
                 ) VALUES ('repo-1', 'owner', 'repo', 'owner/repo', 'main', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO pull_requests (
                    id, repository_id, number, title, url, author_login, head_ref, head_sha,
                    base_ref, draft, state, updated_at, last_synced_at
                 ) VALUES (
                    'pr-1', 'repo-1', 1, 'Existing pull request', 'https://example.test/pr-1',
                    'owner', 'feature', 'abcdef0', 'main', 0, 'OPEN',
                    '2026-08-11T08:00:00Z', '2026-08-11T08:01:00Z'
                 )",
                [],
            )
            .unwrap();
        drop(connection);

        let database = Database::open(path).unwrap();
        let overview = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT body_text, changed_files, additions, deletions
                     FROM pull_requests WHERE id = 'pr-1'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
            })
            .unwrap();

        assert_eq!(overview, (String::new(), 0, 0, 0));
    }
}
