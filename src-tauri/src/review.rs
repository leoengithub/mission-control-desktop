use chrono::Utc;
use rusqlite::params;
use serde::Serialize;

use crate::database::{Database, DatabaseError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: String,
    pub author_login: String,
    pub body: String,
    pub is_bot: bool,
    pub diff_hunk: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThread {
    pub id: String,
    pub path: Option<String>,
    pub line: Option<i64>,
    pub start_line: Option<i64>,
    pub original_line: Option<i64>,
    pub original_start_line: Option<i64>,
    pub side: Option<String>,
    pub resolved: bool,
    pub outdated: bool,
    pub is_bot: bool,
    pub has_new_activity: bool,
    pub updated_at: String,
    pub comments: Vec<ReviewComment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    pub id: String,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub required: bool,
    pub details_url: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReviewDetail {
    pub pull_request_id: String,
    pub threads: Vec<ReviewThread>,
    pub checks: Vec<CheckRun>,
}

pub fn get_review_detail(
    database: &Database,
    pull_request_id: &str,
) -> Result<PullRequestReviewDetail, DatabaseError> {
    database.with_connection(|connection| {
        let mut thread_statement = connection.prepare(
            "SELECT id, path, line, start_line, original_line, original_start_line, side, \
             resolved, outdated, updated_at, last_seen_at \
             FROM review_threads WHERE pull_request_id = ?1 \
             ORDER BY resolved ASC, outdated ASC, updated_at DESC",
        )?;
        let thread_rows = thread_statement
            .query_map([pull_request_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, bool>(7)?,
                    row.get::<_, bool>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(thread_statement);

        let mut threads = Vec::with_capacity(thread_rows.len());
        for (
            id,
            path,
            line,
            start_line,
            original_line,
            original_start_line,
            side,
            resolved,
            outdated,
            updated_at,
            last_seen_at,
        ) in thread_rows
        {
            let mut comment_statement = connection.prepare(
                "SELECT id, author_login, body, is_bot, diff_hunk, created_at, updated_at \
                 FROM review_comments WHERE thread_id = ?1 ORDER BY created_at ASC",
            )?;
            let comments = comment_statement
                .query_map([&id], |row| {
                    Ok(ReviewComment {
                        id: row.get(0)?,
                        author_login: row.get(1)?,
                        body: row.get(2)?,
                        is_bot: row.get(3)?,
                        diff_hunk: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let is_bot = comments.first().is_some_and(|comment| comment.is_bot);
            let has_new_activity = last_seen_at
                .as_deref()
                .is_none_or(|last_seen| updated_at.as_str() > last_seen);
            threads.push(ReviewThread {
                id,
                path,
                line,
                start_line,
                original_line,
                original_start_line,
                side,
                resolved,
                outdated,
                is_bot,
                has_new_activity,
                updated_at,
                comments,
            });
        }

        let mut check_statement = connection.prepare(
            "SELECT id, name, status, conclusion, required, details_url, updated_at \
             FROM check_runs WHERE pull_request_id = ?1 \
             ORDER BY required DESC, name COLLATE NOCASE ASC",
        )?;
        let checks = check_statement
            .query_map([pull_request_id], |row| {
                Ok(CheckRun {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    status: row.get(2)?,
                    conclusion: row.get(3)?,
                    required: row.get(4)?,
                    details_url: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(PullRequestReviewDetail {
            pull_request_id: pull_request_id.to_owned(),
            threads,
            checks,
        })
    })
}

pub fn mark_pull_request_seen(
    database: &Database,
    pull_request_id: &str,
) -> Result<(), DatabaseError> {
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE review_threads SET last_seen_at = ?1 WHERE pull_request_id = ?2",
            params![Utc::now().to_rfc3339(), pull_request_id],
        )?;
        Ok(())
    })
}

pub fn thread_prompt_context(
    database: &Database,
    thread_id: &str,
) -> Result<String, DatabaseError> {
    let detail = database.with_connection(|connection| {
        let (repository, number, title, path, line): (
            String,
            i64,
            String,
            Option<String>,
            Option<i64>,
        ) = connection.query_row(
            "SELECT r.full_name, p.number, p.title, t.path, t.line \
             FROM review_threads t \
             JOIN pull_requests p ON p.id = t.pull_request_id \
             JOIN repositories r ON r.id = p.repository_id WHERE t.id = ?1",
            [thread_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )?;
        let mut statement = connection.prepare(
            "SELECT author_login, body, is_bot FROM review_comments \
             WHERE thread_id = ?1 ORDER BY created_at ASC",
        )?;
        let comments = statement
            .query_map([thread_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((repository, number, title, path, line, comments))
    })?;
    let (repository, number, title, path, line, comments) = detail;
    let location = match (path, line) {
        (Some(path), Some(line)) => format!("{path}:{line}"),
        (Some(path), None) => path,
        _ => "general pull request feedback".into(),
    };
    let comments = comments
        .into_iter()
        .map(|(author, body, is_bot)| {
            format!(
                "{} ({author}):\n{body}",
                if is_bot { "Bot" } else { "Human" }
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(format!(
        "Repository: {repository}\nPull request: #{number} {title}\nLocation: {location}\n\nReview conversation:\n{comments}"
    ))
}
