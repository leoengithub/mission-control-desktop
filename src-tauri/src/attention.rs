#![allow(dead_code, reason = "wired by the GitHub synchronization slice")]

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::{Database, DatabaseError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionReason {
    ReviewRequested,
    UnresolvedThread,
    RequiredChecksFailing,
    AgentWaitingForUser,
    AgentFailed,
    AgentStalled,
    AgentInterrupted,
}

impl AttentionReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::ReviewRequested => "review_requested",
            Self::UnresolvedThread => "unresolved_thread",
            Self::RequiredChecksFailing => "required_checks_failing",
            Self::AgentWaitingForUser => "agent_waiting_for_user",
            Self::AgentFailed => "agent_failed",
            Self::AgentStalled => "agent_stalled",
            Self::AgentInterrupted => "agent_interrupted",
        }
    }

    fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "review_requested" => Ok(Self::ReviewRequested),
            "unresolved_thread" => Ok(Self::UnresolvedThread),
            "required_checks_failing" => Ok(Self::RequiredChecksFailing),
            "agent_waiting_for_user" => Ok(Self::AgentWaitingForUser),
            "agent_failed" => Ok(Self::AgentFailed),
            "agent_stalled" => Ok(Self::AgentStalled),
            "agent_interrupted" => Ok(Self::AgentInterrupted),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionItem {
    pub id: String,
    pub pull_request_id: String,
    pub reason: AttentionReason,
    pub source_id: Option<String>,
    pub summary: String,
    pub first_detected_at: DateTime<Utc>,
    pub last_changed_at: DateTime<Utc>,
    pub snoozed_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionCandidate {
    pub reason: AttentionReason,
    pub source_id: Option<String>,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttentionTransition {
    Activated(AttentionItem),
    Cleared { id: String },
}

type AttentionKey = (AttentionReason, Option<String>);

pub struct AttentionRepository<'database> {
    database: &'database Database,
}

impl<'database> AttentionRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn list_active(&self) -> Result<Vec<AttentionItem>, DatabaseError> {
        self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, pull_request_id, reason, source_id, summary, first_detected_at, \
                 last_changed_at, snoozed_until \
                 FROM attention_items WHERE cleared_at IS NULL \
                 ORDER BY last_changed_at DESC",
            )?;
            let rows = statement.query_map([], map_attention_item)?;
            rows.collect()
        })
    }

    pub fn active_pull_request_count(&self, now: DateTime<Utc>) -> Result<usize, DatabaseError> {
        self.database.with_connection(|connection| {
            connection.query_row(
                "SELECT COUNT(DISTINCT pull_request_id) FROM attention_items \
                 WHERE cleared_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?1)",
                [now.to_rfc3339()],
                |row| row.get(0),
            )
        })
    }

    pub fn reconcile_for_pull_request(
        &self,
        pull_request_id: &str,
        candidates: Vec<AttentionCandidate>,
        now: DateTime<Utc>,
    ) -> Result<Vec<AttentionTransition>, DatabaseError> {
        self.database.with_connection(|connection| {
            let transaction = connection.unchecked_transaction()?;
            let mut existing_statement = transaction.prepare(
                "SELECT id, reason, source_id, summary, cleared_at \
                 FROM attention_items WHERE pull_request_id = ?1",
            )?;
            let existing = existing_statement
                .query_map([pull_request_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        AttentionReason::parse(&row.get::<_, String>(1)?)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            drop(existing_statement);

            let mut existing_by_key: HashMap<AttentionKey, _> = existing
                .into_iter()
                .map(|(id, reason, source_id, summary, cleared_at)| {
                    ((reason, source_id), (id, summary, cleared_at))
                })
                .collect();
            let candidate_keys: HashSet<AttentionKey> = candidates
                .iter()
                .map(|candidate| (candidate.reason, candidate.source_id.clone()))
                .collect();
            let now_text = now.to_rfc3339();
            let mut transitions = Vec::new();

            for candidate in candidates {
                let key = (candidate.reason, candidate.source_id.clone());
                if let Some((id, previous_summary, cleared_at)) = existing_by_key.remove(&key) {
                    if cleared_at.is_some() {
                        transaction.execute(
                            "UPDATE attention_items SET summary = ?1, first_detected_at = ?2, \
                             last_changed_at = ?2, snoozed_until = NULL, cleared_at = NULL \
                             WHERE id = ?3",
                            params![candidate.summary, now_text, id],
                        )?;
                        transitions.push(AttentionTransition::Activated(AttentionItem {
                            id,
                            pull_request_id: pull_request_id.to_owned(),
                            reason: candidate.reason,
                            source_id: candidate.source_id,
                            summary: candidate.summary,
                            first_detected_at: now,
                            last_changed_at: now,
                            snoozed_until: None,
                        }));
                    } else if previous_summary != candidate.summary {
                        transaction.execute(
                            "UPDATE attention_items SET summary = ?1, last_changed_at = ?2 WHERE id = ?3",
                            params![candidate.summary, now_text, id],
                        )?;
                    }
                    continue;
                }

                let id = Uuid::new_v4().to_string();
                transaction.execute(
                    "INSERT INTO attention_items (
                        id, pull_request_id, reason, source_id, summary,
                        first_detected_at, last_changed_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                    params![
                        id,
                        pull_request_id,
                        candidate.reason.as_str(),
                        candidate.source_id,
                        candidate.summary,
                        now_text,
                    ],
                )?;
                transitions.push(AttentionTransition::Activated(AttentionItem {
                    id,
                    pull_request_id: pull_request_id.to_owned(),
                    reason: candidate.reason,
                    source_id: candidate.source_id,
                    summary: candidate.summary,
                    first_detected_at: now,
                    last_changed_at: now,
                    snoozed_until: None,
                }));
            }

            for (key, (id, _, cleared_at)) in existing_by_key {
                if cleared_at.is_none() && !candidate_keys.contains(&key) {
                    transaction.execute(
                        "UPDATE attention_items SET cleared_at = ?1, last_changed_at = ?1 WHERE id = ?2",
                        params![now_text, id],
                    )?;
                    transitions.push(AttentionTransition::Cleared { id });
                }
            }

            transaction.commit()?;
            Ok(transitions)
        })
    }

    pub fn reconcile_github_for_pull_request(
        &self,
        pull_request_id: &str,
        mut candidates: Vec<AttentionCandidate>,
        now: DateTime<Utc>,
    ) -> Result<Vec<AttentionTransition>, DatabaseError> {
        let agent_candidates = self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT reason, source_id, summary FROM attention_items \
                 WHERE pull_request_id = ?1 AND cleared_at IS NULL AND reason IN (
                   'agent_waiting_for_user', 'agent_failed', 'agent_stalled', 'agent_interrupted'
                 )",
            )?;
            statement
                .query_map([pull_request_id], |row| {
                    Ok(AttentionCandidate {
                        reason: AttentionReason::parse(&row.get::<_, String>(0)?)?,
                        source_id: row.get(1)?,
                        summary: row.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
        })?;
        candidates.extend(agent_candidates);
        self.reconcile_for_pull_request(pull_request_id, candidates, now)
    }

    pub fn activate_candidate(
        &self,
        pull_request_id: &str,
        candidate: AttentionCandidate,
        now: DateTime<Utc>,
    ) -> Result<Option<AttentionTransition>, DatabaseError> {
        self.database.with_connection(|connection| {
            let existing = connection
                .query_row(
                    "SELECT id, summary, cleared_at FROM attention_items \
                     WHERE pull_request_id = ?1 AND reason = ?2 AND source_id IS ?3",
                    params![
                        pull_request_id,
                        candidate.reason.as_str(),
                        candidate.source_id
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()?;
            let now_text = now.to_rfc3339();
            if let Some((id, previous_summary, cleared_at)) = existing {
                if cleared_at.is_none() {
                    if previous_summary != candidate.summary {
                        connection.execute(
                            "UPDATE attention_items SET summary = ?1, last_changed_at = ?2 \
                             WHERE id = ?3",
                            params![candidate.summary, now_text, id],
                        )?;
                    }
                    return Ok(None);
                }
                connection.execute(
                    "UPDATE attention_items SET summary = ?1, first_detected_at = ?2, \
                     last_changed_at = ?2, snoozed_until = NULL, cleared_at = NULL WHERE id = ?3",
                    params![candidate.summary, now_text, id],
                )?;
                return Ok(Some(AttentionTransition::Activated(AttentionItem {
                    id,
                    pull_request_id: pull_request_id.to_owned(),
                    reason: candidate.reason,
                    source_id: candidate.source_id,
                    summary: candidate.summary,
                    first_detected_at: now,
                    last_changed_at: now,
                    snoozed_until: None,
                })));
            }
            let id = Uuid::new_v4().to_string();
            connection.execute(
                "INSERT INTO attention_items (
                    id, pull_request_id, reason, source_id, summary,
                    first_detected_at, last_changed_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    id,
                    pull_request_id,
                    candidate.reason.as_str(),
                    candidate.source_id,
                    candidate.summary,
                    now_text,
                ],
            )?;
            Ok(Some(AttentionTransition::Activated(AttentionItem {
                id,
                pull_request_id: pull_request_id.to_owned(),
                reason: candidate.reason,
                source_id: candidate.source_id,
                summary: candidate.summary,
                first_detected_at: now,
                last_changed_at: now,
                snoozed_until: None,
            })))
        })
    }

    pub fn clear_candidate(
        &self,
        pull_request_id: &str,
        reason: AttentionReason,
        source_id: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<Option<AttentionTransition>, DatabaseError> {
        self.database.with_connection(|connection| {
            let id = connection
                .query_row(
                    "SELECT id FROM attention_items WHERE pull_request_id = ?1 AND reason = ?2 \
                     AND source_id IS ?3 AND cleared_at IS NULL",
                    params![pull_request_id, reason.as_str(), source_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(id) = id else {
                return Ok(None);
            };
            connection.execute(
                "UPDATE attention_items SET cleared_at = ?1, last_changed_at = ?1 WHERE id = ?2",
                params![now.to_rfc3339(), id],
            )?;
            Ok(Some(AttentionTransition::Cleared { id }))
        })
    }

    pub fn find_active_by_id(&self, id: &str) -> Result<Option<AttentionItem>, DatabaseError> {
        self.database.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, pull_request_id, reason, source_id, summary, first_detected_at, \
                     last_changed_at, snoozed_until FROM attention_items \
                     WHERE id = ?1 AND cleared_at IS NULL",
                    [id],
                    map_attention_item,
                )
                .optional()
        })
    }
}

fn map_attention_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttentionItem> {
    let first_detected_at = DateTime::parse_from_rfc3339(&row.get::<_, String>(5)?)
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?
        .with_timezone(&Utc);
    let last_changed_at = DateTime::parse_from_rfc3339(&row.get::<_, String>(6)?)
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?
        .with_timezone(&Utc);
    let snoozed_until = row
        .get::<_, Option<String>>(7)?
        .map(|value| DateTime::parse_from_rfc3339(&value).map(|date| date.with_timezone(&Utc)))
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(AttentionItem {
        id: row.get(0)?,
        pull_request_id: row.get(1)?,
        reason: AttentionReason::parse(&row.get::<_, String>(2)?)?,
        source_id: row.get(3)?,
        summary: row.get(4)?,
        first_detected_at,
        last_changed_at,
        snoozed_until,
    })
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use tempfile::tempdir;

    use super::*;

    fn database_with_pr() -> Database {
        let directory = tempdir().unwrap().keep();
        let database = Database::open(directory.join("attention.sqlite3")).unwrap();
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
                        'pr-1', 'repo-1', 1, 'Test PR', 'https://example.test/pr/1', 'owner',
                        'feature', 'abc123', 'main', 0, 'open', '2026-08-03T12:00:00Z',
                        '2026-08-03T12:00:00Z'
                     )",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        database
    }

    #[test]
    fn activates_without_repeating_and_clears_when_state_recovers() {
        let database = database_with_pr();
        let repository = AttentionRepository::new(&database);
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap();
        let candidate = AttentionCandidate {
            reason: AttentionReason::RequiredChecksFailing,
            source_id: None,
            summary: "Required checks are failing".into(),
        };

        let first = repository
            .reconcile_for_pull_request("pr-1", vec![candidate.clone()], now)
            .unwrap();
        assert!(matches!(
            first.as_slice(),
            [AttentionTransition::Activated(_)]
        ));

        let second = repository
            .reconcile_for_pull_request("pr-1", vec![candidate], now)
            .unwrap();
        assert!(second.is_empty());

        let cleared = repository
            .reconcile_for_pull_request("pr-1", vec![], now)
            .unwrap();
        assert!(matches!(
            cleared.as_slice(),
            [AttentionTransition::Cleared { .. }]
        ));
        assert!(repository.list_active().unwrap().is_empty());
    }

    #[test]
    fn recurrence_is_a_new_activation_and_clears_old_snooze() {
        let database = database_with_pr();
        let repository = AttentionRepository::new(&database);
        let first_time = Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap();
        let second_time = Utc.with_ymd_and_hms(2026, 8, 3, 13, 0, 0).unwrap();
        let candidate = AttentionCandidate {
            reason: AttentionReason::ReviewRequested,
            source_id: None,
            summary: "Your review is requested".into(),
        };
        repository
            .reconcile_for_pull_request("pr-1", vec![candidate.clone()], first_time)
            .unwrap();
        repository
            .reconcile_for_pull_request("pr-1", vec![], first_time)
            .unwrap();
        let recurring = repository
            .reconcile_for_pull_request("pr-1", vec![candidate], second_time)
            .unwrap();
        assert!(matches!(
            recurring.as_slice(),
            [AttentionTransition::Activated(_)]
        ));
        let active = repository.list_active().unwrap();
        assert_eq!(active[0].first_detected_at, second_time);
        assert_eq!(active[0].snoozed_until, None);
    }

    #[test]
    fn github_reconciliation_preserves_local_agent_attention() {
        let database = database_with_pr();
        let repository = AttentionRepository::new(&database);
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap();
        repository
            .activate_candidate(
                "pr-1",
                AttentionCandidate {
                    reason: AttentionReason::AgentWaitingForUser,
                    source_id: Some("run-1".into()),
                    summary: "Agent is waiting".into(),
                },
                now,
            )
            .unwrap();

        repository
            .reconcile_github_for_pull_request("pr-1", Vec::new(), now)
            .unwrap();

        let active = repository.list_active().unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].reason, AttentionReason::AgentWaitingForUser);
    }

    #[test]
    fn badge_count_deduplicates_pull_requests_and_excludes_snoozed_items() {
        let database = database_with_pr();
        let repository = AttentionRepository::new(&database);
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap();
        repository
            .reconcile_for_pull_request(
                "pr-1",
                vec![
                    AttentionCandidate {
                        reason: AttentionReason::RequiredChecksFailing,
                        source_id: None,
                        summary: "Required checks are failing".into(),
                    },
                    AttentionCandidate {
                        reason: AttentionReason::UnresolvedThread,
                        source_id: Some("thread-1".into()),
                        summary: "A review thread is unresolved".into(),
                    },
                ],
                now,
            )
            .unwrap();
        assert_eq!(repository.active_pull_request_count(now).unwrap(), 1);

        database
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE attention_items SET snoozed_until = ?1",
                    [(now + chrono::Duration::hours(1)).to_rfc3339()],
                )?;
                Ok(())
            })
            .unwrap();
        assert_eq!(repository.active_pull_request_count(now).unwrap(), 0);
    }
}
