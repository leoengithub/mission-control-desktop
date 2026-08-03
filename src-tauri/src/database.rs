use std::{fs, path::PathBuf, sync::Mutex};

use rusqlite::{Connection, OpenFlags};
use thiserror::Error;

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");

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
        connection.execute_batch(INITIAL_MIGRATION)?;
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
        assert_eq!(version, 1);
    }
}
