use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::Utc;
use reqwest::{Client, StatusCode, header};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;
use thiserror::Error;

use crate::{
    attention::{AttentionCandidate, AttentionReason, AttentionRepository, AttentionTransition},
    database::{Database, DatabaseError},
};

const GRAPHQL_URL: &str = "https://api.github.com/graphql";
const USER_REPOSITORIES_URL: &str = "https://api.github.com/user/repos";
const ACTIONABLE_BOT_KEYWORDS: [&str; 11] = [
    "error", "fail", "failed", "failure", "block", "blocked", "blocking", "required", "must",
    "critical", "breaking",
];
const SEARCH_QUERY: &str = r#"
query PullRequestInbox($query: String!, $after: String) {
  search(query: $query, type: ISSUE, first: 50, after: $after) {
    nodes {
      ... on PullRequest {
        id number title url isDraft state mergeStateStatus reviewDecision
        bodyText changedFiles additions deletions
        updatedAt headRefName headRefOid baseRefName
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
        nodes {
          id isResolved isOutdated path line startLine originalLine originalStartLine diffSide
          comments(first: 100) {
            nodes {
              id body diffHunk createdAt updatedAt
              author { login }
            }
            pageInfo { hasNextPage }
          }
        }
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
    #[error("GitHub rate limit reached; retry in {retry_after_seconds} seconds")]
    RateLimited { retry_after_seconds: u64 },
    #[error("GitHub GraphQL error: {0}")]
    Graphql(String),
    #[error("GitHub repository access failed: {0}")]
    RepositoryAccess(String),
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
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    pub draft: bool,
    pub review_requested: bool,
    pub merge_state_status: String,
    pub review_decision: Option<String>,
    pub body_text: String,
    pub changed_files: i64,
    pub additions: i64,
    pub deletions: i64,
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
        let repositories = self.repositories(access_token).await?;
        let accessible_repository_count = repositories.len() as u32;
        persist_accessible_repositories(database, &repositories)?;
        mark_repository_discovery(database, accessible_repository_count)?;
        if !repository_selection_completed(database)? {
            return Ok((
                GithubSyncResult {
                    pull_request_count: 0,
                    attention_transition_count: 0,
                    completed_at: Utc::now().to_rfc3339(),
                },
                Vec::new(),
            ));
        }
        let monitored_repository_ids = monitored_repository_ids(database)?;
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
        pull_requests
            .retain(|pull_request| monitored_repository_ids.contains(&pull_request.repository.id));
        pull_requests.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        persist_discovery(database, &pull_requests, &requested_ids)?;

        let mut transitions = Vec::new();
        for pull_request in &pull_requests {
            let review_requested = requested_ids.contains(&pull_request.id);
            let detail = self.attention(access_token, &pull_request.id).await?;
            persist_attention_detail(database, &pull_request.id, &detail)?;
            let threads = detail.threads;
            let failing_checks = detail.failing_required_checks;
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
                AttentionRepository::new(database).reconcile_github_for_pull_request(
                    &pull_request.id,
                    derive_attention_candidates(&snapshot, &login),
                    Utc::now(),
                )?,
            );
        }
        mark_sync_complete(database, accessible_repository_count)?;
        Ok((
            GithubSyncResult {
                pull_request_count: pull_requests.len(),
                attention_transition_count: transitions.len(),
                completed_at: Utc::now().to_rfc3339(),
            },
            transitions,
        ))
    }

    pub async fn reply_to_thread(
        &self,
        access_token: &str,
        thread_id: &str,
        body: &str,
    ) -> Result<(), GithubSyncError> {
        let _: serde_json::Value = self
            .graphql(
                access_token,
                r#"
                mutation ReplyToReviewThread($threadId: ID!, $body: String!) {
                  addPullRequestReviewThreadReply(
                    input: { pullRequestReviewThreadId: $threadId, body: $body }
                  ) { comment { id } }
                }
                "#,
                json!({ "threadId": thread_id, "body": body }),
            )
            .await?;
        Ok(())
    }

    pub async fn resolve_thread(
        &self,
        access_token: &str,
        thread_id: &str,
    ) -> Result<(), GithubSyncError> {
        let _: serde_json::Value = self
            .graphql(
                access_token,
                r#"
                mutation ResolveReviewThread($threadId: ID!) {
                  resolveReviewThread(input: { threadId: $threadId }) {
                    thread { id isResolved }
                  }
                }
                "#,
                json!({ "threadId": thread_id }),
            )
            .await?;
        Ok(())
    }

    pub async fn request_copilot_review(
        &self,
        access_token: &str,
        repository: &str,
        number: i64,
    ) -> Result<(), GithubSyncError> {
        let url =
            format!("https://api.github.com/repos/{repository}/pulls/{number}/requested_reviewers");
        let response = self
            .client
            .post(&url)
            .bearer_auth(access_token)
            .json(&json!({ "reviewers": ["copilot-pull-request-reviewer[bot]"] }))
            .send()
            .await
            .map_err(GithubSyncError::Request)?;
        let status = response.status();
        let response_headers = response.headers().clone();
        if status.is_success() {
            return Ok(());
        }
        if is_rate_limited(status, &response_headers) {
            return Err(GithubSyncError::RateLimited {
                retry_after_seconds: retry_after_seconds(&response_headers),
            });
        }
        if status == StatusCode::UNPROCESSABLE_ENTITY {
            return Err(GithubSyncError::Graphql(
                "GitHub did not accept Copilot for this repository; check the repository or organization Copilot review policy"
                    .into(),
            ));
        }
        Err(GithubSyncError::Http(status))
    }

    async fn repositories(
        &self,
        access_token: &str,
    ) -> Result<Vec<SearchRepository>, GithubSyncError> {
        let mut page = 1_u32;
        let mut repositories = Vec::new();
        loop {
            let url = format!(
                "{USER_REPOSITORIES_URL}?affiliation=owner,collaborator,organization_member&visibility=all&sort=full_name&direction=asc&per_page=100&page={page}"
            );
            let response = self
                .client
                .get(url)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(GithubSyncError::Request)?;
            let status = response.status();
            let response_headers = response.headers().clone();
            validate_repository_response(status, &response_headers)?;
            let has_next_page = response_headers
                .get(header::LINK)
                .and_then(|value| value.to_str().ok())
                .is_some_and(link_header_has_next_page);
            let page_repositories = response
                .json::<Vec<RestRepository>>()
                .await
                .map_err(GithubSyncError::Request)?;
            repositories.extend(page_repositories.into_iter().map(SearchRepository::from));
            if !has_next_page {
                return Ok(repositories);
            }
            page = page.checked_add(1).ok_or_else(|| {
                GithubSyncError::RepositoryAccess("repository pagination overflowed".into())
            })?;
        }
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
                .review_threads
                .nodes
                .iter()
                .flatten()
                .any(|thread| thread.comments.page_info.has_next_page)
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
            .map(review_thread_snapshot)
            .filter(thread_is_actionable)
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
        let status = response.status();
        let response_headers = response.headers().clone();
        if !status.is_success() {
            if is_rate_limited(status, &response_headers) {
                return Err(GithubSyncError::RateLimited {
                    retry_after_seconds: retry_after_seconds(&response_headers),
                });
            }
            return Err(GithubSyncError::Http(status));
        }
        let response = response
            .json::<GraphqlEnvelope<T>>()
            .await
            .map_err(GithubSyncError::Request)?;
        if !response.errors.is_empty() {
            let message = response
                .errors
                .into_iter()
                .map(|error| error.message)
                .collect::<Vec<_>>()
                .join("; ");
            if message.to_ascii_lowercase().contains("rate limit") {
                return Err(GithubSyncError::RateLimited {
                    retry_after_seconds: retry_after_seconds(&response_headers),
                });
            }
            return Err(GithubSyncError::Graphql(message));
        }
        response
            .data
            .ok_or_else(|| GithubSyncError::Graphql("response did not contain data".into()))
    }
}

fn is_rate_limited(status: StatusCode, headers: &header::HeaderMap) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN
            && headers
                .get("x-ratelimit-remaining")
                .and_then(|value| value.to_str().ok())
                == Some("0"))
}

fn validate_repository_response(
    status: StatusCode,
    headers: &header::HeaderMap,
) -> Result<(), GithubSyncError> {
    if is_rate_limited(status, headers) {
        return Err(GithubSyncError::RateLimited {
            retry_after_seconds: retry_after_seconds(headers),
        });
    }
    let sso_header = headers
        .get("x-github-sso")
        .and_then(|value| value.to_str().ok());
    let partial_sso_results = status.is_success()
        && sso_header.is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|state| state.trim().eq_ignore_ascii_case("partial-results"))
        });
    if partial_sso_results || (status == StatusCode::FORBIDDEN && sso_header.is_some()) {
        return Err(GithubSyncError::RepositoryAccess(
            "your GitHub CLI token needs organization SSO authorization; authorize it in GitHub, then refresh"
                .into(),
        ));
    }
    if status == StatusCode::UNAUTHORIZED {
        return Err(GithubSyncError::RepositoryAccess(
            "the active GitHub CLI token is no longer authorized; run `gh auth status`, then reconnect"
                .into(),
        ));
    }
    if !status.is_success() {
        return Err(GithubSyncError::Http(status));
    }
    Ok(())
}

fn retry_after_seconds(headers: &header::HeaderMap) -> u64 {
    if let Some(seconds) = headers
        .get(header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
    {
        return seconds.max(1);
    }
    if let Some(reset_at) = headers
        .get("x-ratelimit-reset")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
    {
        return reset_at.saturating_sub(Utc::now().timestamp()).max(1) as u64;
    }
    300
}

fn link_header_has_next_page(value: &str) -> bool {
    value
        .split(',')
        .any(|link| link.split(';').any(|part| part.trim() == "rel=\"next\""))
}

pub fn list_cached_pull_requests(
    database: &Database,
) -> Result<Vec<CachedPullRequest>, DatabaseError> {
    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "SELECT p.id, r.full_name, p.number, p.title, p.url, p.author_login, p.head_ref, \
             p.head_sha, p.base_ref, p.draft, p.review_requested, p.merge_state_status, \
             p.review_decision, p.body_text, p.changed_files, p.additions, p.deletions, \
             p.updated_at, p.last_synced_at \
             FROM pull_requests p JOIN repositories r ON r.id = p.repository_id \
             WHERE p.in_scope = 1 AND p.state = 'OPEN' AND r.accessible = 1 \
             AND r.monitored = 1 ORDER BY p.updated_at DESC",
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
                    head_ref: row.get(6)?,
                    head_sha: row.get(7)?,
                    base_ref: row.get(8)?,
                    draft: row.get(9)?,
                    review_requested: row.get(10)?,
                    merge_state_status: row.get(11)?,
                    review_decision: row.get(12)?,
                    body_text: row.get(13)?,
                    changed_files: row.get(14)?,
                    additions: row.get(15)?,
                    deletions: row.get(16)?,
                    updated_at: row.get(17)?,
                    last_synced_at: row.get(18)?,
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

fn repository_selection_completed(database: &Database) -> Result<bool, DatabaseError> {
    database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT value FROM app_state WHERE key = 'repository_selection_completed'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map(|value| value.is_some_and(|value| value == "true"))
    })
}

fn monitored_repository_ids(database: &Database) -> Result<HashSet<String>, DatabaseError> {
    database.with_connection(|connection| {
        let mut statement = connection
            .prepare("SELECT id FROM repositories WHERE accessible = 1 AND monitored = 1")?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect()
    })
}

fn persist_accessible_repositories(
    database: &Database,
    repositories: &[SearchRepository],
) -> Result<(), DatabaseError> {
    let synced_at = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute("UPDATE repositories SET accessible = 0", [])?;
        for repository in repositories {
            let (owner, name) = repository
                .name_with_owner
                .split_once('/')
                .unwrap_or(("unknown", repository.name_with_owner.as_str()));
            transaction.execute(
                "INSERT INTO repositories (
                    id, owner, name, full_name, default_branch, private, last_synced_at,
                    monitored, accessible
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1)
                 ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, name=excluded.name,
                 full_name=excluded.full_name, default_branch=excluded.default_branch,
                 private=excluded.private, last_synced_at=excluded.last_synced_at,
                 accessible=1, sync_error=NULL",
                rusqlite::params![
                    repository.id,
                    owner,
                    name,
                    repository.name_with_owner,
                    repository
                        .default_branch_ref
                        .as_ref()
                        .map_or("", |branch| branch.name.as_str()),
                    repository.is_private,
                    synced_at,
                ],
            )?;
        }
        transaction.commit()
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
                 head_ref, head_sha, base_ref, draft, review_requested, merge_state_status, \
                 review_decision, body_text, changed_files, additions, deletions, in_scope, state, \
                 updated_at, last_synced_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 1, ?18, ?19, ?20) \
                 ON CONFLICT(id) DO UPDATE SET repository_id=excluded.repository_id, number=excluded.number, \
                 title=excluded.title, url=excluded.url, author_login=excluded.author_login, \
                 head_ref=excluded.head_ref, head_sha=excluded.head_sha, base_ref=excluded.base_ref, \
                 draft=excluded.draft, review_requested=excluded.review_requested, \
                 merge_state_status=excluded.merge_state_status, review_decision=excluded.review_decision, \
                 body_text=excluded.body_text, changed_files=excluded.changed_files, \
                 additions=excluded.additions, deletions=excluded.deletions, in_scope=1, \
                 state=excluded.state, updated_at=excluded.updated_at, last_synced_at=excluded.last_synced_at",
                rusqlite::params![pull_request.id, repository.id, pull_request.number, pull_request.title,
                    pull_request.url, pull_request.author.as_ref().map_or("ghost", |author| author.login.as_str()),
                    pull_request.head_ref_name, pull_request.head_ref_oid, pull_request.base_ref_name,
                    pull_request.is_draft, requested_ids.contains(&pull_request.id),
                    pull_request.merge_state_status, pull_request.review_decision,
                    pull_request.body_text, pull_request.changed_files, pull_request.additions,
                    pull_request.deletions, pull_request.state,
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
        let incoming_thread_ids: HashSet<_> = detail
            .threads
            .iter()
            .map(|thread| thread.id.as_str())
            .collect();
        let existing_thread_ids = {
            let mut statement = transaction
                .prepare("SELECT id FROM review_threads WHERE pull_request_id = ?1")?;
            statement
                .query_map([pull_request_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for existing_id in existing_thread_ids {
            if !incoming_thread_ids.contains(existing_id.as_str()) {
                transaction.execute("DELETE FROM review_threads WHERE id = ?1", [existing_id])?;
            }
        }
        transaction.execute("DELETE FROM check_runs WHERE pull_request_id = ?1", [pull_request_id])?;
        for thread in &detail.threads {
            let updated_at = thread
                .comments
                .last()
                .map_or(now.as_str(), |comment| comment.updated_at.as_str());
            transaction.execute(
                "INSERT INTO review_threads (
                    id, pull_request_id, path, line, start_line, original_line,
                    original_start_line, side, resolved, outdated, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET path=excluded.path, line=excluded.line,
                 start_line=excluded.start_line, original_line=excluded.original_line,
                 original_start_line=excluded.original_start_line, side=excluded.side,
                 resolved=excluded.resolved, outdated=excluded.outdated,
                 updated_at=excluded.updated_at",
                rusqlite::params![
                    thread.id,
                    pull_request_id,
                    thread.path,
                    thread.line,
                    thread.start_line,
                    thread.original_line,
                    thread.original_start_line,
                    thread.diff_side,
                    thread.resolved,
                    thread.outdated,
                    updated_at,
                ],
            )?;
            transaction.execute("DELETE FROM review_comments WHERE thread_id = ?1", [&thread.id])?;
            for comment in &thread.comments {
                transaction.execute(
                    "INSERT INTO review_comments (
                        id, thread_id, author_login, body, is_bot, diff_hunk, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        comment.id,
                        thread.id,
                        comment.author_login,
                        comment.body,
                        comment.is_bot,
                        comment.diff_hunk,
                        comment.created_at,
                        comment.updated_at,
                    ],
                )?;
            }
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

fn mark_sync_complete(
    database: &Database,
    accessible_repository_count: u32,
) -> Result<(), DatabaseError> {
    let now = Utc::now().to_rfc3339();
    let accessible_repository_count = accessible_repository_count.to_string();
    database.with_connection(|connection| {
        for (key, value) in [
            ("initial_sync_completed", "true"),
            ("last_inbox_sync_at", now.as_str()),
            (
                "accessible_repository_count",
                accessible_repository_count.as_str(),
            ),
        ] {
            connection.execute(
                "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3) \
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                rusqlite::params![key, value, now],
            )?;
        }
        Ok(())
    })
}

fn mark_repository_discovery(
    database: &Database,
    accessible_repository_count: u32,
) -> Result<(), DatabaseError> {
    let now = Utc::now().to_rfc3339();
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO app_state (key, value, updated_at) \
             VALUES ('accessible_repository_count', ?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            rusqlite::params![accessible_repository_count.to_string(), now],
        )?;
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
    merge_state_status: String,
    review_decision: Option<String>,
    body_text: String,
    changed_files: i64,
    additions: i64,
    deletions: i64,
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
struct RestRepository {
    node_id: String,
    full_name: String,
    private: bool,
    visibility: Option<String>,
    default_branch: Option<String>,
}

impl From<RestRepository> for SearchRepository {
    fn from(repository: RestRepository) -> Self {
        let is_private = repository.private
            || repository
                .visibility
                .as_deref()
                .is_some_and(|visibility| visibility != "public");
        Self {
            id: repository.node_id,
            name_with_owner: repository.full_name,
            is_private,
            default_branch_ref: repository
                .default_branch
                .filter(|branch| !branch.is_empty())
                .map(|name| BranchRef { name }),
        }
    }
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
    path: Option<String>,
    line: Option<i64>,
    start_line: Option<i64>,
    original_line: Option<i64>,
    original_start_line: Option<i64>,
    diff_side: Option<String>,
    comments: ReviewCommentConnection,
}

#[derive(Deserialize)]
struct ReviewCommentConnection {
    nodes: Vec<Option<ReviewCommentNode>>,
    #[serde(rename = "pageInfo")]
    page_info: HasNextPage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewCommentNode {
    id: String,
    body: String,
    diff_hunk: Option<String>,
    created_at: String,
    updated_at: String,
    author: Option<Actor>,
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
    pub path: Option<String>,
    pub line: Option<i64>,
    pub start_line: Option<i64>,
    pub original_line: Option<i64>,
    pub original_start_line: Option<i64>,
    pub diff_side: Option<String>,
    pub comments: Vec<ReviewCommentSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewCommentSnapshot {
    pub id: String,
    pub author_login: String,
    pub body: String,
    pub is_bot: bool,
    pub diff_hunk: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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

fn review_thread_snapshot(thread: ThreadNode) -> ReviewThreadSnapshot {
    let comments = thread
        .comments
        .nodes
        .into_iter()
        .flatten()
        .map(|comment| {
            let author_login = comment
                .author
                .map_or_else(|| "ghost".into(), |author| author.login);
            ReviewCommentSnapshot {
                id: comment.id,
                is_bot: is_bot_login(&author_login),
                author_login,
                body: comment.body,
                diff_hunk: comment.diff_hunk,
                created_at: comment.created_at,
                updated_at: comment.updated_at,
            }
        })
        .collect();
    ReviewThreadSnapshot {
        id: thread.id,
        resolved: thread.is_resolved,
        outdated: thread.is_outdated,
        path: thread.path,
        line: thread.line,
        start_line: thread.start_line,
        original_line: thread.original_line,
        original_start_line: thread.original_start_line,
        diff_side: thread.diff_side,
        comments,
    }
}

fn is_bot_login(login: &str) -> bool {
    let normalized = login.to_ascii_lowercase();
    normalized.ends_with("[bot]") || normalized.ends_with("-bot") || normalized == "copilot"
}

fn thread_is_actionable(thread: &ReviewThreadSnapshot) -> bool {
    if !thread
        .comments
        .first()
        .is_some_and(|comment| comment.is_bot)
    {
        return true;
    }
    thread.comments.iter().any(|comment| {
        let body = comment.body.to_ascii_lowercase();
        ACTIONABLE_BOT_KEYWORDS
            .iter()
            .any(|keyword| body.contains(keyword))
    })
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
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn rest_repository_discovery_keeps_private_and_internal_repositories() {
        let private: RestRepository = serde_json::from_value(json!({
            "node_id": "R_private",
            "full_name": "revolico/private-web",
            "private": true,
            "visibility": "private",
            "default_branch": "main"
        }))
        .unwrap();
        let internal: RestRepository = serde_json::from_value(json!({
            "node_id": "R_internal",
            "full_name": "revolico/internal-tools",
            "private": false,
            "visibility": "internal",
            "default_branch": "trunk"
        }))
        .unwrap();
        let empty: RestRepository = serde_json::from_value(json!({
            "node_id": "R_empty",
            "full_name": "revolico/empty",
            "private": false,
            "visibility": "public",
            "default_branch": null
        }))
        .unwrap();

        let private = SearchRepository::from(private);
        let internal = SearchRepository::from(internal);
        let empty = SearchRepository::from(empty);

        assert!(private.is_private);
        assert!(internal.is_private);
        assert_eq!(private.name_with_owner, "revolico/private-web");
        assert_eq!(
            internal
                .default_branch_ref
                .as_ref()
                .map(|branch| branch.name.as_str()),
            Some("trunk")
        );
        assert!(empty.default_branch_ref.is_none());
    }

    #[test]
    fn repository_pagination_follows_only_the_next_link() {
        assert!(link_header_has_next_page(
            "<https://api.github.com/user/repos?page=2>; rel=\"next\", <https://api.github.com/user/repos?page=4>; rel=\"last\""
        ));
        assert!(!link_header_has_next_page(
            "<https://api.github.com/user/repos?page=1>; rel=\"prev\", <https://api.github.com/user/repos?page=4>; rel=\"last\""
        ));
    }

    #[test]
    fn partial_sso_repository_results_are_not_authoritative() {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            "x-github-sso",
            header::HeaderValue::from_static("partial-results; organizations=21955855,20582480"),
        );

        assert!(matches!(
            validate_repository_response(StatusCode::OK, &headers),
            Err(GithubSyncError::RepositoryAccess(message))
                if message.contains("SSO authorization")
        ));
        assert!(validate_repository_response(StatusCode::OK, &header::HeaderMap::new()).is_ok());
    }

    #[test]
    fn search_pull_request_deserializes_factual_overview_fields() {
        let pull_request: SearchPullRequest = serde_json::from_value(json!({
            "id": "pr-1",
            "number": 1,
            "title": "Review factual overview",
            "url": "https://github.com/owner/repo/pull/1",
            "isDraft": false,
            "state": "OPEN",
            "mergeStateStatus": "CLEAN",
            "reviewDecision": "APPROVED",
            "bodyText": "Explain the change.",
            "changedFiles": 4,
            "additions": 42,
            "deletions": 7,
            "updatedAt": "2026-08-11T08:00:00Z",
            "headRefName": "feature/overview",
            "headRefOid": "abcdef0",
            "baseRefName": "main",
            "author": { "login": "owner" },
            "repository": {
                "id": "repo-1",
                "nameWithOwner": "owner/repo",
                "isPrivate": false,
                "defaultBranchRef": { "name": "main" }
            }
        }))
        .unwrap();

        assert_eq!(pull_request.body_text, "Explain the change.");
        assert_eq!(pull_request.changed_files, 4);
        assert_eq!(pull_request.additions, 42);
        assert_eq!(pull_request.deletions, 7);
    }

    #[test]
    fn cached_pull_request_serializes_factual_overview_fields() {
        let value = serde_json::to_value(CachedPullRequest {
            id: "pr-1".into(),
            repository: "owner/repo".into(),
            number: 1,
            title: "Review factual overview".into(),
            url: "https://github.com/owner/repo/pull/1".into(),
            author_login: "owner".into(),
            head_ref: "feature/overview".into(),
            head_sha: "abcdef0".into(),
            base_ref: "main".into(),
            draft: false,
            review_requested: false,
            merge_state_status: "CLEAN".into(),
            review_decision: Some("APPROVED".into()),
            body_text: "Explain the change.".into(),
            changed_files: 4,
            additions: 42,
            deletions: 7,
            updated_at: "2026-08-11T08:00:00Z".into(),
            last_synced_at: "2026-08-11T08:01:00Z".into(),
        })
        .unwrap();

        assert_eq!(value["bodyText"], "Explain the change.");
        assert_eq!(value["changedFiles"], 4);
        assert_eq!(value["additions"], 42);
        assert_eq!(value["deletions"], 7);
    }

    #[test]
    fn discovery_persists_and_reads_factual_overview_fields() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("sync.sqlite3")).unwrap();
        let pull_request = SearchPullRequest {
            id: "pr-1".into(),
            number: 1,
            title: "Review factual overview".into(),
            url: "https://github.com/owner/repo/pull/1".into(),
            is_draft: false,
            state: "OPEN".into(),
            merge_state_status: "CLEAN".into(),
            review_decision: Some("APPROVED".into()),
            body_text: "Explain the change.".into(),
            changed_files: 4,
            additions: 42,
            deletions: 7,
            updated_at: "2026-08-11T08:00:00Z".into(),
            head_ref_name: "feature/overview".into(),
            head_ref_oid: "abcdef0".into(),
            base_ref_name: "main".into(),
            author: Some(Actor {
                login: "owner".into(),
            }),
            repository: SearchRepository {
                id: "repo-1".into(),
                name_with_owner: "owner/repo".into(),
                is_private: false,
                default_branch_ref: Some(BranchRef {
                    name: "main".into(),
                }),
            },
        };

        persist_discovery(&database, &[pull_request], &HashSet::new()).unwrap();
        let cached = list_cached_pull_requests(&database).unwrap();

        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].body_text, "Explain the change.");
        assert_eq!(cached[0].changed_files, 4);
        assert_eq!(cached[0].additions, 42);
        assert_eq!(cached[0].deletions, 7);
    }

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

    fn thread(id: &str, resolved: bool, outdated: bool) -> ReviewThreadSnapshot {
        ReviewThreadSnapshot {
            id: id.into(),
            resolved,
            outdated,
            path: Some("src/example.ts".into()),
            line: Some(12),
            start_line: None,
            original_line: Some(12),
            original_start_line: None,
            diff_side: Some("RIGHT".into()),
            comments: Vec::new(),
        }
    }

    #[test]
    fn authored_pr_surfaces_threads_and_required_checks() {
        let mut value = snapshot();
        value.failing_required_check_names = vec!["CI".into(), "E2E".into()];
        value.review_threads = vec![
            thread("thread-open", false, false),
            thread("thread-resolved", true, false),
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
        value.review_threads = vec![thread("thread-open", false, false)];
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

    #[test]
    fn rate_limit_responses_are_detected_without_retrying_immediately() {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            "x-ratelimit-remaining",
            header::HeaderValue::from_static("0"),
        );
        headers.insert(header::RETRY_AFTER, header::HeaderValue::from_static("47"));
        assert!(is_rate_limited(StatusCode::FORBIDDEN, &headers));
        assert_eq!(retry_after_seconds(&headers), 47);
    }

    #[test]
    fn ordinary_forbidden_responses_are_not_misclassified() {
        assert!(!is_rate_limited(
            StatusCode::FORBIDDEN,
            &header::HeaderMap::new()
        ));
        assert_eq!(retry_after_seconds(&header::HeaderMap::new()), 300);
    }

    #[test]
    fn bot_threads_require_an_actionable_keyword() {
        let mut review_thread = thread("bot-thread", false, false);
        review_thread.comments.push(ReviewCommentSnapshot {
            id: "comment-1".into(),
            author_login: "reviewer[bot]".into(),
            body: "Consider renaming this variable.".into(),
            is_bot: true,
            diff_hunk: None,
            created_at: "2026-08-03T12:00:00Z".into(),
            updated_at: "2026-08-03T12:00:00Z".into(),
        });
        assert!(!thread_is_actionable(&review_thread));
        review_thread.comments[0].body = "This failure blocks the required check.".into();
        assert!(thread_is_actionable(&review_thread));
    }
}
