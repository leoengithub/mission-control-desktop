BEGIN;

ALTER TABLE pull_requests ADD COLUMN merge_state_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE pull_requests ADD COLUMN review_decision TEXT;

PRAGMA user_version = 4;
COMMIT;
