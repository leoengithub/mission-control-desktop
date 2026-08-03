use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::Utc;
use reqwest::{Client, StatusCode, header};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;
use thiserror::Error;

use crate::{
    attention::{AttentionCandidate, AttentionReason, AttentionRepository, AttentionTransition},
    database::{Database, DatabaseError},
};

const GRAPHQL_URL: &str = "https://api.github.com/graphql";
const SEARCH_QUERY: &str = r#"
query PullRequestInbox($query: String!, $after: String) {
  search(query: $query, type: ISSUE, first: 50, after: $after) {
    nodes {
      ... on PullRequest {
        id number title url isDraft state updatedAt headRefName headRefOid baseRefName
        author { login }
        repository {
          id nameWithOwner isPrivate
          defaultBranchRef { name }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
  rateLimit { cost remaining resetAt }
}
"#;
const ATTENTION_QUERY: &str = r#"
query PullRequestAttention($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      reviewThreads(first: 100) {
        nodes { id isResolved isOutdated }
        pageInfo { hasNextPage }
      }
      statusCheckRollup {
        contexts(first: 100) {
          nodes {
            __typename
            ... on CheckRun {
              id name status conclusion detailsUrl
              isRequired(pullRequestId: $id)
            }
            ... on StatusContext {
              id context state targetUrl
              isRequired(pullRequestId: $id)
            }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
"#;

#[derive(Debug, Error)]
pub enum GithubSyncError {
    #[error("GitHub request failed: {0}")]
    Request(#[source] reqwest::Error),
    #[error("GitHub returned HTTP {0}")]
    Http(StatusCode),
    #[error("GitHub GraphQL error: {0}")]
    Graphql(String),
    #[error("GitHub returned more review data than this version can safely reconcile")]
    PaginationLimit,
    #[error(transparent)]
    Database(#[from] DatabaseError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedPullRequest {
    pub id: String,
    pub repository: String,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub author_login: String,
    pub head_sha: String,
    pub draft: bool,
    pub review_requested: bool,
    pub updated_at: String,
    pub last_synced_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSyncResult {
    pub pull_request_count: usize,
    pub attention_transition_count: usize,
    pub completed_at: String,
}

pub struct GithubSyncService {
    client: Client,
}

impl GithubSyncService {
    pub fn new() -> Result<Self, reqwest::Error> {
        Client::builder()
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
            .map(|client| Self { client })
    }

    pub async fn refresh(
        &self,
        database: &Database,
        access_token: &str,
    ) -> Result<(GithubSyncResult, Vec<AttentionTransition>), GithubSyncError> {
        let login = github_login(database)?;
        let authored_query = format!("is:pr is:open author:{login}");
        let requested_query = format!("is:pr is:open review-requested:{login}");
        let authored = self.search(access_token, &authored_query).await?;
        let requested = self.search(access_token, &requested_query).await?;
        let requested_ids: HashSet<_> = requested
            .iter()
            .map(|pull_request| pull_request.id.clone())
            .collect();
        let mut by_id = HashMap::new();
        for pull_request in authored.into_iter().chain(requested) {
            by_id.entry(pull_request.id.clone()).or_insert(pull_request);
        }
        let mut pull_requests: Vec<_> = by_id.into_values().collect();
        pull_requests.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        persist_discovery(database, &pull_requests, &requested_ids)?;

        let mut transitions = Vec::new();
        for pull_request in &pull_requests {
            let review_requested = requested_ids.contains(&pull_request.id);
            let (threads, failing_checks) = if pull_request
                .author
                .as_ref()
                .is_some_and(|author| author.login.eq_ignore_ascii_case(&login))
            {
                let detail = self.attention(access_token, &pull_request.id).await?;
                persist_attention_detail(database, &pull_request.id, &detail)?;
                (detail.threads, detail.failing_required_checks)
            } else {
                (Vec::new(), Vec::new())
            };
            let snapshot = PullRequestAttentionSnapshot {
                id: pull_request.id.clone(),
                title: pull_request.title.clone(),
                author_login: pull_request
                    .author
                    .as_ref()
                    .map_or_else(|| "ghost".into(), |author| author.login.clone()),
                review_requested_from_viewer: review_requested,
                failing_required_check_names: failing_checks,
                review_threads: threads,
            };
            transitions.extend(
                AttentionRepository::new(database).reconcile_for_pull_request(
                    &pull_request.id,
                    derive_attention_candidates(&snapshot, &login),
                    Utc::now(),
                )?,
            );
        }
        mark_sync_complete(database)?;
        Ok((
            GithubSyncResult {
                pull_request_count: pull_requests.len(),
                attention_transition_count: transitions.len(),
                completed_at: Utc::now().to_rfc3339(),
            },
            transitions,
        ))
    }

    async fn search(
        &self,
        access_token: &str,
        query: &str,
    ) -> Result<Vec<SearchPullRequest>, GithubSyncError> {
        let mut cursor: Option<String> = None;
        let mut pull_requests = Vec::new();
        loop {
            let data: SearchData = self
                .graphql(
                    access_token,
                    SEARCH_QUERY,
                    json!({ "query": query, "after": cursor }),
                )
                .await?;
            pull_requests.extend(data.search.nodes.into_iter().flatten());
            if !data.search.page_info.has_next_page {
                return Ok(pull_requests);
            }
            cursor = data.search.page_info.end_cursor;
            if cursor.is_none() {
                return Err(GithubSyncError::Graphql(
                    "search pagination omitted its end cursor".into(),
                ));
            }
        }
    }

    async fn attention(
        &self,
        access_token: &str,
        pull_request_id: &str,
    ) -> Result<AttentionDetail, GithubSyncError> {
        let data: AttentionData = self
            .graphql(
                access_token,
                ATTENTION_QUERY,
                json!({ "id": pull_request_id }),
            )
            .await?;
        let node = data
            .node
            .ok_or_else(|| GithubSyncError::Graphql("pull request no longer exists".into()))?;
        if node.review_threads.page_info.has_next_page
            || node
                .status_check_rollup
                .as_ref()
                .is_some_and(|rollup| rollup.contexts.page_info.has_next_page)
        {
            return Err(GithubSyncError::PaginationLimit);
        }
        let threads = node
            .review_threads
            .nodes
            .into_iter()
            .flatten()
            .map(|thread| ReviewThreadSnapshot {
                id: thread.id,
                resolved: thread.is_resolved,
                outdated: thread.is_outdated,
            })
            .collect();
        let checks = node
            .status_check_rollup
            .map(|rollup| {
                rollup
                    .contexts
                    .nodes
                    .into_iter()
                    .flatten()
                    .map(CheckSnapshot::from)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let failing_required_checks = checks
            .iter()
            .filter(|check| check.required && check.failing)
            .map(|check| check.name.clone())
            .collect();
        Ok(AttentionDetail {
            threads,
            checks,
            failing_required_checks,
        })
    }

    async fn graphql<T: DeserializeOwned>(
        &self,
        access_token: &str,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<T, GithubSyncError> {
        let response = self
            .client
            .post(GRAPHQL_URL)
            .bearer_auth(access_token)
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await
            .map_err(GithubSyncError::Request)?;
        if !response.status().is_success() {
            return Err(GithubSyncError::Http(response.status()));
        }
        let response = response
            .json::<GraphqlEnvelope<T>>()
            .await
            .map_err(GithubSyncError::Request)?;
        if !response.errors.is_empty() {
            return Err(GithubSyncError::Graphql(
                response
                    .errors
                    .into_iter()
                    .map(|error| error.message)
                    .collect::<Vec<_>>()
                    .join("; "),
            ));
        }
        response
            .data
            .ok_or_else(|| GithubSyncError::Graphql("response did not contain data".into()))
    }
}

pub fn list_cached_pull_requests(
    database: &Database,
) -> Result<Vec<CachedPullRequest>, DatabaseError> {
    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "SELECT p.id, r.full_name, p.number, p.title, p.url, p.author_login, p.head_sha, \
             p.draft, p.review_requested, p.updated_at, p.last_synced_at \
             FROM pull_requests p JOIN repositories r ON r.id = p.repository_id \
             WHERE p.in_scope = 1 AND p.state = 'OPEN' ORDER BY p.updated_at DESC",
        )?;
        statement
            .query_map([], |row| {
                Ok(CachedPullRequest {
                    id: row.get(0)?,
                    repository: row.get(1)?,
                    number: row.get(2)?,
                    title: row.get(3)?,
                    url: row.get(4)?,
                    author_login: row.get(5)?,
                    head_sha: row.get(6)?,
                    draft: row.get(7)?,
                    review_requested: row.get(8)?,
                    updated_at: row.get(9)?,
                    last_synced_at: row.get(10)?,
                })
            })?
            .collect()
    })
}

fn github_login(database: &Database) -> Result<String, DatabaseError> {
    database.with_connection(|connection| {
        connection.query_row(
            "SELECT login FROM github_accounts WHERE needs_reauthorization = 0 \
             ORDER BY authorized_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
    })
}

fn persist_discovery(
    database: &Database,
    pull_requests: &[SearchPullRequest],
    requested_ids: &HashSet<String>,
) -> Result<(), DatabaseError> {
    let synced_at = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute("UPDATE pull_requests SET in_scope = 0, review_requested = 0", [])?;
        for pull_request in pull_requests {
            let repository = &pull_request.repository;
            let (owner, name) = repository
                .name_with_owner
                .split_once('/')
                .unwrap_or(("unknown", repository.name_with_owner.as_str()));
            transaction.execute(
                "INSERT INTO repositories (id, owner, name, full_name, default_branch, private, last_synced_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                 ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, name=excluded.name, \
                 full_name=excluded.full_name, default_branch=excluded.default_branch, \
                 private=excluded.private, last_synced_at=excluded.last_synced_at, sync_error=NULL",
                rusqlite::params![repository.id, owner, name, repository.name_with_owner,
                    repository.default_branch_ref.as_ref().map_or("", |branch| branch.name.as_str()),
                    repository.is_private, synced_at],
            )?;
            transaction.execute(
                "INSERT INTO pull_requests (id, repository_id, number, title, url, author_login, \
                 head_ref, head_sha, base_ref, draft, review_requested, in_scope, state, updated_at, last_synced_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?13, ?14) \
                 ON CONFLICT(id) DO UPDATE SET repository_id=excluded.repository_id, number=excluded.number, \
                 title=excluded.title, url=excluded.url, author_login=excluded.author_login, \
                 head_ref=excluded.head_ref, head_sha=excluded.head_sha, base_ref=excluded.base_ref, \
                 draft=excluded.draft, review_requested=excluded.review_requested, in_scope=1, \
                 state=excluded.state, updated_at=excluded.updated_at, last_synced_at=excluded.last_synced_at",
                rusqlite::params![pull_request.id, repository.id, pull_request.number, pull_request.title,
                    pull_request.url, pull_request.author.as_ref().map_or("ghost", |author| author.login.as_str()),
                    pull_request.head_ref_name, pull_request.head_ref_oid, pull_request.base_ref_name,
                    pull_request.is_draft, requested_ids.contains(&pull_request.id), pull_request.state,
                    pull_request.updated_at, synced_at],
            )?;
        }
        transaction.commit()
    })
}

fn persist_attention_detail(
    database: &Database,
    pull_request_id: &str,
    detail: &AttentionDetail,
) -> Result<(), DatabaseError> {
    let now = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM review_threads WHERE pull_request_id = ?1", [pull_request_id])?;
        transaction.execute("DELETE FROM check_runs WHERE pull_request_id = ?1", [pull_request_id])?;
        for thread in &detail.threads {
            transaction.execute(
                "INSERT INTO review_threads (id, pull_request_id, resolved, outdated, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![thread.id, pull_request_id, thread.resolved, thread.outdated, now],
            )?;
        }
        for check in &detail.checks {
            transaction.execute(
                "INSERT INTO check_runs (id, pull_request_id, name, status, conclusion, required, details_url, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![check.id, pull_request_id, check.name, check.status, check.conclusion,
                    check.required, check.details_url, now],
            )?;
        }
        transaction.commit()
    })
}

fn mark_sync_complete(database: &Database) -> Result<(), DatabaseError> {
    let now = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        for (key, value) in [("initial_sync_completed", "true"), ("last_inbox_sync_at", now.as_str())] {
            connection.execute(
                "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3) \
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                rusqlite::params![key, value, now],
            )?;
        }
        Ok(())
    })
}

#[derive(Deserialize)]
struct GraphqlEnvelope<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}

#[derive(Deserialize)]
struct GraphqlError {
    message: String,
}

#[derive(Deserialize)]
struct SearchData {
    search: SearchConnection,
}

#[derive(Deserialize)]
struct SearchConnection {
    nodes: Vec<Option<SearchPullRequest>>,
    #[serde(rename = "pageInfo")]
    page_info: PageInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchPullRequest {
    id: String,
    number: i64,
    title: String,
    url: String,
    is_draft: bool,
    state: String,
    updated_at: String,
    head_ref_name: String,
    head_ref_oid: String,
    base_ref_name: String,
    author: Option<Actor>,
    repository: SearchRepository,
}

#[derive(Deserialize)]
struct Actor {
    login: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRepository {
    id: String,
    name_with_owner: String,
    is_private: bool,
    default_branch_ref: Option<BranchRef>,
}

#[derive(Deserialize)]
struct BranchRef {
    name: String,
}

#[derive(Deserialize)]
struct AttentionData {
    node: Option<AttentionNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttentionNode {
    review_threads: ThreadConnection,
    status_check_rollup: Option<StatusRollup>,
}

#[derive(Deserialize)]
struct ThreadConnection {
    nodes: Vec<Option<ThreadNode>>,
    #[serde(rename = "pageInfo")]
    page_info: HasNextPage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadNode {
    id: String,
    is_resolved: bool,
    is_outdated: bool,
}

#[derive(Deserialize)]
struct StatusRollup {
    contexts: CheckConnection,
}

#[derive(Deserialize)]
struct CheckConnection {
    nodes: Vec<Option<GraphqlCheck>>,
    #[serde(rename = "pageInfo")]
    page_info: HasNextPage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HasNextPage {
    has_next_page: bool,
}

#[derive(Deserialize)]
#[serde(tag = "__typename")]
enum GraphqlCheck {
    CheckRun {
        id: String,
        name: String,
        status: String,
        conclusion: Option<String>,
        #[serde(rename = "detailsUrl")]
        details_url: Option<String>,
        #[serde(rename = "isRequired")]
        is_required: bool,
    },
    StatusContext {
        id: String,
        context: String,
        state: String,
        #[serde(rename = "targetUrl")]
        target_url: Option<String>,
        #[serde(rename = "isRequired")]
        is_required: bool,
    },
}

struct AttentionDetail {
    threads: Vec<ReviewThreadSnapshot>,
    checks: Vec<CheckSnapshot>,
    failing_required_checks: Vec<String>,
}

struct CheckSnapshot {
    id: String,
    name: String,
    status: String,
    conclusion: Option<String>,
    required: bool,
    details_url: Option<String>,
    failing: bool,
}

impl From<GraphqlCheck> for CheckSnapshot {
    fn from(check: GraphqlCheck) -> Self {
        match check {
            GraphqlCheck::CheckRun {
                id,
                name,
                status,
                conclusion,
                details_url,
                is_required,
            } => {
                let failing = conclusion.as_deref().is_some_and(|value| {
                    matches!(
                        value,
                        "ACTION_REQUIRED"
                            | "CANCELLED"
                            | "FAILURE"
                            | "STALE"
                            | "STARTUP_FAILURE"
                            | "TIMED_OUT"
                    )
                });
                Self {
                    id,
                    name,
                    status,
                    conclusion,
                    required: is_required,
                    details_url,
                    failing,
                }
            }
            GraphqlCheck::StatusContext {
                id,
                context,
                state,
                target_url,
                is_required,
            } => {
                let failing = matches!(state.as_str(), "ERROR" | "FAILURE");
                Self {
                    id,
                    name: context,
                    status: state.clone(),
                    conclusion: Some(state),
                    required: is_required,
                    details_url: target_url,
                    failing,
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewThreadSnapshot {
    pub id: String,
    pub resolved: bool,
    pub outdated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestAttentionSnapshot {
    pub id: String,
    pub title: String,
    pub author_login: String,
    pub review_requested_from_viewer: bool,
    pub failing_required_check_names: Vec<String>,
    pub review_threads: Vec<ReviewThreadSnapshot>,
}

pub fn derive_attention_candidates(
    snapshot: &PullRequestAttentionSnapshot,
    viewer_login: &str,
) -> Vec<AttentionCandidate> {
    let mut candidates = Vec::new();

    if snapshot.review_requested_from_viewer {
        candidates.push(AttentionCandidate {
            reason: AttentionReason::ReviewRequested,
            source_id: None,
            summary: format!("Review requested: {}", snapshot.title),
        });
    }

    if snapshot.author_login.eq_ignore_ascii_case(viewer_login) {
        if !snapshot.failing_required_check_names.is_empty() {
            candidates.push(AttentionCandidate {
                reason: AttentionReason::RequiredChecksFailing,
                source_id: None,
                summary: format_required_checks_summary(&snapshot.failing_required_check_names),
            });
        }
        candidates.extend(
            snapshot
                .review_threads
                .iter()
                .filter(|thread| !thread.resolved && !thread.outdated)
                .map(|thread| AttentionCandidate {
                    reason: AttentionReason::UnresolvedThread,
                    source_id: Some(thread.id.clone()),
                    summary: format!("Unresolved review thread on {}", snapshot.title),
                }),
        );
    }

    candidates
}

fn format_required_checks_summary(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [name] => format!("Required check failing: {name}"),
        [first, second] => format!("Required checks failing: {first}, {second}"),
        [first, second, rest @ ..] => format!(
            "Required checks failing: {first}, {second}, and {} more",
            rest.len()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> PullRequestAttentionSnapshot {
        PullRequestAttentionSnapshot {
            id: "pr-1".into(),
            title: "Improve review flow".into(),
            author_login: "viewer".into(),
            review_requested_from_viewer: false,
            failing_required_check_names: Vec::new(),
            review_threads: Vec::new(),
        }
    }

    #[test]
    fn authored_pr_surfaces_threads_and_required_checks() {
        let mut value = snapshot();
        value.failing_required_check_names = vec!["CI".into(), "E2E".into()];
        value.review_threads = vec![
            ReviewThreadSnapshot {
                id: "thread-open".into(),
                resolved: false,
                outdated: false,
            },
            ReviewThreadSnapshot {
                id: "thread-resolved".into(),
                resolved: true,
                outdated: false,
            },
        ];
        let candidates = derive_attention_candidates(&value, "VIEWER");
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].reason, AttentionReason::RequiredChecksFailing);
        assert_eq!(candidates[1].source_id.as_deref(), Some("thread-open"));
    }

    #[test]
    fn requested_review_is_actionable_without_treating_others_threads_as_viewer_work() {
        let mut value = snapshot();
        value.author_login = "someone-else".into();
        value.review_requested_from_viewer = true;
        value.failing_required_check_names = vec!["CI".into()];
        value.review_threads = vec![ReviewThreadSnapshot {
            id: "thread-open".into(),
            resolved: false,
            outdated: false,
        }];
        let candidates = derive_attention_candidates(&value, "viewer");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].reason, AttentionReason::ReviewRequested);
    }

    #[test]
    fn unrelated_pr_has_no_attention_reasons() {
        let mut value = snapshot();
        value.author_login = "someone-else".into();
        value.failing_required_check_names = vec!["CI".into()];
        assert!(derive_attention_candidates(&value, "viewer").is_empty());
    }
}
