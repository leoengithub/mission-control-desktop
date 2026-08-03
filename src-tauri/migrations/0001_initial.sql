BEGIN;

CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_accounts (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    avatar_url TEXT,
    authorized_at TEXT NOT NULL,
    access_token_expires_at TEXT,
    refresh_token_expires_at TEXT,
    needs_reauthorization INTEGER NOT NULL DEFAULT 0 CHECK (needs_reauthorization IN (0, 1))
);

CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL UNIQUE,
    default_branch TEXT NOT NULL,
    private INTEGER NOT NULL CHECK (private IN (0, 1)),
    last_synced_at TEXT,
    sync_error TEXT
);

CREATE TABLE IF NOT EXISTS pull_requests (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    author_login TEXT NOT NULL,
    head_ref TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    draft INTEGER NOT NULL CHECK (draft IN (0, 1)),
    review_requested INTEGER NOT NULL DEFAULT 0 CHECK (review_requested IN (0, 1)),
    in_scope INTEGER NOT NULL DEFAULT 1 CHECK (in_scope IN (0, 1)),
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    UNIQUE(repository_id, number)
);

CREATE TABLE IF NOT EXISTS review_threads (
    id TEXT PRIMARY KEY,
    pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    path TEXT,
    line INTEGER,
    side TEXT,
    resolved INTEGER NOT NULL CHECK (resolved IN (0, 1)),
    outdated INTEGER NOT NULL CHECK (outdated IN (0, 1)),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_comments (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES review_threads(id) ON DELETE CASCADE,
    author_login TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_runs (
    id TEXT PRIMARY KEY,
    pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    conclusion TEXT,
    required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
    details_url TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attention_items (
    id TEXT PRIMARY KEY,
    pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    source_id TEXT,
    summary TEXT NOT NULL,
    first_detected_at TEXT NOT NULL,
    last_changed_at TEXT NOT NULL,
    snoozed_until TEXT,
    cleared_at TEXT,
    UNIQUE(pull_request_id, reason, source_id)
);

CREATE INDEX IF NOT EXISTS idx_attention_active
    ON attention_items(cleared_at, snoozed_until, last_changed_at DESC);

CREATE TABLE IF NOT EXISTS notification_deliveries (
    attention_item_id TEXT NOT NULL REFERENCES attention_items(id) ON DELETE CASCADE,
    transition_key TEXT NOT NULL,
    delivered_at TEXT NOT NULL,
    PRIMARY KEY(attention_item_id, transition_key)
);

CREATE TABLE IF NOT EXISTS review_drafts (
    id TEXT PRIMARY KEY,
    pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    head_sha TEXT NOT NULL,
    path TEXT NOT NULL,
    side TEXT NOT NULL,
    line INTEGER NOT NULL,
    start_line INTEGER,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_repositories (
    repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
    local_path TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    validation_state TEXT NOT NULL,
    last_validated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    status TEXT NOT NULL,
    worktree_path TEXT,
    log_path TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    summary TEXT
);

PRAGMA user_version = 1;
COMMIT;
