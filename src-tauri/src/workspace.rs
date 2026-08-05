use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use serde::Serialize;
use thiserror::Error;

use crate::{
    database::{Database, DatabaseError},
    settings::AppSettings,
};

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error(transparent)]
    Database(#[from] DatabaseError),
    #[error("local repository path does not exist: {0}")]
    MissingPath(String),
    #[error("could not inspect local repository: {0}")]
    Git(String),
    #[error("selected folder is not the root of a Git repository")]
    NotRepositoryRoot,
    #[error("local repository remote is {actual}; expected {expected}")]
    RemoteMismatch { expected: String, actual: String },
    #[error("attach this GitHub repository in Settings before starting a local action")]
    NotAttached,
    #[error("worktree path is outside Mission Control's configured worktree directory")]
    UnsafeWorktreePath,
    #[error("worktree has uncommitted changes and was preserved")]
    DirtyWorktree,
    #[error("worktree head changed from its original pull request commit and was preserved")]
    UniqueCommits,
    #[error("could not create worktree directory: {0}")]
    CreateDirectory(#[source] std::io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepositoryAttachment {
    pub repository_id: String,
    pub repository: String,
    pub monitored: bool,
    pub local_path: Option<String>,
    pub default_branch: String,
    pub validation_state: String,
    pub last_validated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeContext {
    pub repository_id: String,
    pub repository: String,
    pub pull_request_id: String,
    pub number: i64,
    pub title: String,
    pub head_ref: String,
    pub head_sha: String,
    pub repository_path: PathBuf,
    pub worktree_path: PathBuf,
}

pub fn list_local_repositories(
    database: &Database,
) -> Result<Vec<LocalRepositoryAttachment>, WorkspaceError> {
    database
        .with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT r.id, r.full_name, r.monitored, lr.local_path, r.default_branch, \
                 COALESCE(lr.validation_state, 'not_attached'), lr.last_validated_at \
                 FROM repositories r LEFT JOIN local_repositories lr ON lr.repository_id = r.id \
                 WHERE r.accessible = 1 ORDER BY r.full_name COLLATE NOCASE ASC",
            )?;
            statement
                .query_map([], |row| {
                    Ok(LocalRepositoryAttachment {
                        repository_id: row.get(0)?,
                        repository: row.get(1)?,
                        monitored: row.get(2)?,
                        local_path: row.get(3)?,
                        default_branch: row.get(4)?,
                        validation_state: row.get(5)?,
                        last_validated_at: row.get(6)?,
                    })
                })?
                .collect()
        })
        .map_err(WorkspaceError::Database)
}

pub fn set_repository_monitoring(
    database: &Database,
    repository_ids: &[String],
) -> Result<Vec<LocalRepositoryAttachment>, WorkspaceError> {
    let now = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute(
            "UPDATE repositories SET monitored = 0 WHERE accessible = 1",
            [],
        )?;
        for repository_id in repository_ids {
            transaction.execute(
                "UPDATE repositories SET monitored = 1 WHERE id = ?1 AND accessible = 1",
                [repository_id],
            )?;
        }
        transaction.execute(
            "INSERT INTO app_state (key, value, updated_at) \
             VALUES ('repository_selection_completed', 'true', ?1) \
             ON CONFLICT(key) DO UPDATE SET value='true', updated_at=excluded.updated_at",
            [&now],
        )?;
        transaction.commit()
    })?;
    list_local_repositories(database)
}

pub fn attach_local_repository(
    database: &Database,
    repository_id: &str,
    local_path: &str,
) -> Result<LocalRepositoryAttachment, WorkspaceError> {
    let path = PathBuf::from(local_path);
    if !path.exists() {
        return Err(WorkspaceError::MissingPath(local_path.into()));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| WorkspaceError::Git(error.to_string()))?;
    let root = git(&canonical, &["rev-parse", "--show-toplevel"])?;
    let root = PathBuf::from(root);
    let canonical_root = root
        .canonicalize()
        .map_err(|error| WorkspaceError::Git(error.to_string()))?;
    if canonical != canonical_root {
        return Err(WorkspaceError::NotRepositoryRoot);
    }
    let remote = git(&canonical, &["remote", "get-url", "origin"])?;
    let actual = normalize_github_remote(&remote).unwrap_or(remote);
    let (expected, default_branch) = database.with_connection(|connection| {
        connection.query_row(
            "SELECT full_name, default_branch FROM repositories WHERE id = ?1",
            [repository_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
    })?;
    if !actual.eq_ignore_ascii_case(&expected) {
        return Err(WorkspaceError::RemoteMismatch { expected, actual });
    }
    let validated_at = Utc::now().to_rfc3339();
    let canonical_text = canonical.to_string_lossy().to_string();
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO local_repositories (
                repository_id, local_path, default_branch, validation_state, last_validated_at
             ) VALUES (?1, ?2, ?3, 'valid', ?4)
             ON CONFLICT(repository_id) DO UPDATE SET local_path=excluded.local_path,
             default_branch=excluded.default_branch, validation_state='valid',
             last_validated_at=excluded.last_validated_at",
            params![repository_id, canonical_text, default_branch, validated_at],
        )?;
        Ok(())
    })?;
    Ok(LocalRepositoryAttachment {
        repository_id: repository_id.into(),
        repository: expected,
        monitored: database.with_connection(|connection| {
            connection.query_row(
                "SELECT monitored FROM repositories WHERE id = ?1",
                [repository_id],
                |row| row.get(0),
            )
        })?,
        local_path: Some(canonical_text),
        default_branch,
        validation_state: "valid".into(),
        last_validated_at: Some(validated_at),
    })
}

pub fn ensure_worktree(
    database: &Database,
    settings: &AppSettings,
    pull_request_id: &str,
    thread_id: &str,
    action: &str,
) -> Result<WorktreeContext, WorkspaceError> {
    let mut context = database
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT r.id, r.full_name, p.id, p.number, p.title, p.head_ref, p.head_sha, \
                 lr.local_path FROM pull_requests p \
                 JOIN repositories r ON r.id = p.repository_id \
                 LEFT JOIN local_repositories lr ON lr.repository_id = r.id \
                 WHERE p.id = ?1 AND lr.validation_state = 'valid'",
                    [pull_request_id],
                    |row| {
                        Ok(WorktreeContext {
                            repository_id: row.get(0)?,
                            repository: row.get(1)?,
                            pull_request_id: row.get(2)?,
                            number: row.get(3)?,
                            title: row.get(4)?,
                            head_ref: row.get(5)?,
                            head_sha: row.get(6)?,
                            repository_path: PathBuf::from(row.get::<_, String>(7)?),
                            worktree_path: PathBuf::new(),
                        })
                    },
                )
                .optional()
        })?
        .ok_or(WorkspaceError::NotAttached)?;
    let base = settings
        .worktrees
        .base_directory
        .clone()
        .unwrap_or_else(|| {
            context
                .repository_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(".mission-control-worktrees")
        });
    fs::create_dir_all(&base).map_err(WorkspaceError::CreateDirectory)?;
    let repository_slug = safe_slug(&context.repository);
    let thread_slug = safe_slug(thread_id);
    let action_slug = safe_slug(action);
    let worktree_path = base.join(repository_slug).join(format!(
        "{}-{}-{}-{}",
        context.number,
        tail(&thread_slug, 12),
        tail(&action_slug, 18),
        tail(&safe_slug(&context.head_sha), 8)
    ));
    fs::create_dir_all(
        worktree_path
            .parent()
            .ok_or(WorkspaceError::UnsafeWorktreePath)?,
    )
    .map_err(WorkspaceError::CreateDirectory)?;
    if worktree_path.exists() {
        let inside = git(&worktree_path, &["rev-parse", "--is-inside-work-tree"])?;
        if inside == "true" {
            context.worktree_path = worktree_path;
            return Ok(context);
        }
        return Err(WorkspaceError::UnsafeWorktreePath);
    }
    if git(
        &context.repository_path,
        &[
            "cat-file",
            "-e",
            &format!("{}^{{commit}}", context.head_sha),
        ],
    )
    .is_err()
    {
        let _ = git(
            &context.repository_path,
            &["fetch", "origin", &format!("pull/{}/head", context.number)],
        );
    }
    git(
        &context.repository_path,
        &[
            "worktree",
            "add",
            "--detach",
            worktree_path.to_string_lossy().as_ref(),
            &context.head_sha,
        ],
    )?;
    context.worktree_path = worktree_path;
    Ok(context)
}

pub fn cleanup_worktree(
    repository_path: &Path,
    worktree_path: &Path,
    configured_base: &Path,
    expected_head_sha: &str,
) -> Result<(), WorkspaceError> {
    let canonical_base = configured_base
        .canonicalize()
        .map_err(|error| WorkspaceError::Git(error.to_string()))?;
    let canonical_worktree = worktree_path
        .canonicalize()
        .map_err(|error| WorkspaceError::Git(error.to_string()))?;
    if !canonical_worktree.starts_with(&canonical_base) || canonical_worktree == canonical_base {
        return Err(WorkspaceError::UnsafeWorktreePath);
    }
    if !git(&canonical_worktree, &["status", "--porcelain"])?.is_empty() {
        return Err(WorkspaceError::DirtyWorktree);
    }
    if git(&canonical_worktree, &["rev-parse", "HEAD"])? != expected_head_sha {
        return Err(WorkspaceError::UniqueCommits);
    }
    git(
        repository_path,
        &[
            "worktree",
            "remove",
            canonical_worktree.to_string_lossy().as_ref(),
        ],
    )?;
    Ok(())
}

fn git(cwd: &Path, args: &[&str]) -> Result<String, WorkspaceError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| WorkspaceError::Git(error.to_string()))?;
    if !output.status.success() {
        return Err(WorkspaceError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn normalize_github_remote(remote: &str) -> Option<String> {
    let value = remote.trim().trim_end_matches('/').trim_end_matches(".git");
    let path = if let Some(path) = value.strip_prefix("git@github.com:") {
        path
    } else if let Some(path) = value.strip_prefix("ssh://git@github.com/") {
        path
    } else if let Some(path) = value.strip_prefix("https://github.com/") {
        path
    } else {
        value.strip_prefix("http://github.com/")?
    };
    let mut parts = path.split('/');
    let owner = parts.next()?;
    let repository = parts.next()?;
    if owner.is_empty() || repository.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{repository}"))
}

fn safe_slug(value: &str) -> String {
    let slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let slug = slug.trim_matches('-').replace("--", "-");
    if slug.is_empty() { "item".into() } else { slug }
}

fn tail(value: &str, maximum: usize) -> &str {
    if value.len() <= maximum {
        value
    } else {
        &value[value.len() - maximum..]
    }
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn normalizes_common_github_remote_formats() {
        for remote in [
            "git@github.com:owner/repo.git",
            "ssh://git@github.com/owner/repo.git",
            "https://github.com/owner/repo.git",
        ] {
            assert_eq!(
                normalize_github_remote(remote).as_deref(),
                Some("owner/repo")
            );
        }
        assert_eq!(
            normalize_github_remote("https://example.com/owner/repo"),
            None
        );
    }

    #[test]
    fn repository_monitoring_is_an_explicit_persisted_selection() {
        let directory = TempDir::new().unwrap();
        let database = Database::open(directory.path().join("monitoring.sqlite3")).unwrap();
        database
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO repositories (
                        id, owner, name, full_name, default_branch, private, monitored, accessible
                     ) VALUES
                        ('repo-1', 'owner', 'one', 'owner/one', 'main', 0, 0, 1),
                        ('repo-2', 'owner', 'two', 'owner/two', 'main', 0, 1, 1);",
                )?;
                Ok(())
            })
            .unwrap();

        let repositories = set_repository_monitoring(&database, &["repo-1".into()]).unwrap();

        assert_eq!(repositories.len(), 2);
        assert!(
            repositories
                .iter()
                .any(|repository| { repository.repository_id == "repo-1" && repository.monitored })
        );
        assert!(
            repositories.iter().any(|repository| {
                repository.repository_id == "repo-2" && !repository.monitored
            })
        );
        let completed = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT value FROM app_state WHERE key = 'repository_selection_completed'",
                    [],
                    |row| row.get::<_, String>(0),
                )
            })
            .unwrap();
        assert_eq!(completed, "true");
    }

    #[test]
    fn worktree_slugs_never_include_path_separators() {
        assert_eq!(safe_slug("PR_kwDO/a:b"), "pr_kwdo-a-b");
        assert_eq!(tail("abcdefghijklmnop", 8), "ijklmnop");
    }

    #[test]
    fn cleanup_removes_only_an_unchanged_registered_worktree() {
        let (directory, repository, head) = repository_with_commit();
        let base = directory.path().join("worktrees");
        fs::create_dir_all(&base).unwrap();
        let worktree = base.join("clean");
        git(
            &repository,
            &[
                "worktree",
                "add",
                "--detach",
                worktree.to_string_lossy().as_ref(),
                &head,
            ],
        )
        .unwrap();

        cleanup_worktree(&repository, &worktree, &base, &head).unwrap();

        assert!(!worktree.exists());
    }

    #[test]
    fn cleanup_preserves_dirty_and_changed_head_worktrees() {
        let (directory, repository, head) = repository_with_commit();
        let base = directory.path().join("worktrees");
        fs::create_dir_all(&base).unwrap();
        let dirty = base.join("dirty");
        git(
            &repository,
            &[
                "worktree",
                "add",
                "--detach",
                dirty.to_string_lossy().as_ref(),
                &head,
            ],
        )
        .unwrap();
        fs::write(dirty.join("untracked.txt"), "preserve me").unwrap();
        assert!(matches!(
            cleanup_worktree(&repository, &dirty, &base, &head),
            Err(WorkspaceError::DirtyWorktree)
        ));
        assert!(dirty.exists());

        let changed = base.join("changed-head");
        git(
            &repository,
            &[
                "worktree",
                "add",
                "--detach",
                changed.to_string_lossy().as_ref(),
                &head,
            ],
        )
        .unwrap();
        fs::write(changed.join("tracked.txt"), "changed\n").unwrap();
        git(&changed, &["add", "tracked.txt"]).unwrap();
        git(&changed, &["commit", "-m", "local work"]).unwrap();
        assert!(matches!(
            cleanup_worktree(&repository, &changed, &base, &head),
            Err(WorkspaceError::UniqueCommits)
        ));
        assert!(changed.exists());
    }

    fn repository_with_commit() -> (TempDir, PathBuf, String) {
        let directory = tempfile::tempdir().unwrap();
        let repository = directory.path().join("repository");
        fs::create_dir_all(&repository).unwrap();
        git(&repository, &["init", "--initial-branch", "main"]).unwrap();
        git(
            &repository,
            &["config", "user.name", "Mission Control Test"],
        )
        .unwrap();
        git(
            &repository,
            &["config", "user.email", "mission-control@example.test"],
        )
        .unwrap();
        fs::write(repository.join("tracked.txt"), "initial\n").unwrap();
        git(&repository, &["add", "tracked.txt"]).unwrap();
        git(&repository, &["commit", "-m", "initial"]).unwrap();
        let head = git(&repository, &["rev-parse", "HEAD"]).unwrap();
        (directory, repository, head)
    }
}
