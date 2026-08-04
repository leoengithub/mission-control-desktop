BEGIN;

ALTER TABLE review_threads ADD COLUMN start_line INTEGER;
ALTER TABLE review_threads ADD COLUMN original_line INTEGER;
ALTER TABLE review_threads ADD COLUMN original_start_line INTEGER;
ALTER TABLE review_threads ADD COLUMN last_seen_at TEXT;

ALTER TABLE review_comments ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0
    CHECK (is_bot IN (0, 1));
ALTER TABLE review_comments ADD COLUMN diff_hunk TEXT;

ALTER TABLE agent_runs ADD COLUMN thread_id TEXT REFERENCES review_threads(id) ON DELETE SET NULL;
ALTER TABLE agent_runs ADD COLUMN action TEXT NOT NULL DEFAULT 'open_terminal';
ALTER TABLE agent_runs ADD COLUMN base_head_sha TEXT;
ALTER TABLE agent_runs ADD COLUMN exit_code INTEGER;
ALTER TABLE agent_runs ADD COLUMN last_output_at TEXT;
ALTER TABLE agent_runs ADD COLUMN reply_posted_at TEXT;
ALTER TABLE agent_runs ADD COLUMN resolved_at TEXT;

CREATE INDEX IF NOT EXISTS idx_review_threads_pull_request
    ON review_threads(pull_request_id, resolved, outdated, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_pull_request
    ON agent_runs(pull_request_id, started_at DESC);

PRAGMA user_version = 2;
COMMIT;
