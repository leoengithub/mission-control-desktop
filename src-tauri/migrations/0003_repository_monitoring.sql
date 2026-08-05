BEGIN;

ALTER TABLE repositories ADD COLUMN monitored INTEGER NOT NULL DEFAULT 1
    CHECK (monitored IN (0, 1));
ALTER TABLE repositories ADD COLUMN accessible INTEGER NOT NULL DEFAULT 1
    CHECK (accessible IN (0, 1));

INSERT INTO app_state (key, value, updated_at)
SELECT 'repository_selection_completed', 'true', datetime('now')
WHERE EXISTS (
    SELECT 1 FROM app_state
    WHERE key = 'initial_sync_completed' AND value = 'true'
);

PRAGMA user_version = 3;
COMMIT;
