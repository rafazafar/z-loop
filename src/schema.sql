CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES('paused','false');
CREATE TABLE IF NOT EXISTS work_items(
 id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 specification TEXT NOT NULL, acceptance_json TEXT NOT NULL, workflow TEXT NOT NULL CHECK(workflow IN ('code','plan')),
 priority INTEGER NOT NULL, metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs(
 id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES work_items(id), revision INTEGER NOT NULL,
 workflow_version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('active','waiting','succeeded','failed','cancelled')),
 repair_count INTEGER NOT NULL DEFAULT 0, context_json TEXT NOT NULL DEFAULT '{}',
 created_at INTEGER NOT NULL, finished_at INTEGER, UNIQUE(work_id,revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(work_id) WHERE status IN ('active','waiting');
CREATE TABLE IF NOT EXISTS dependencies(work_id TEXT NOT NULL REFERENCES work_items(id), requires_id TEXT NOT NULL REFERENCES work_items(id), PRIMARY KEY(work_id,requires_id), CHECK(work_id != requires_id));
CREATE TABLE IF NOT EXISTS steps(
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','running','waiting','retry_scheduled','succeeded','rejected','failed','cancelled')),
 position INTEGER NOT NULL, input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT,
 next_at INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 0, attempt_count INTEGER NOT NULL DEFAULT 0,
 failure_class TEXT, error TEXT, wait_kind TEXT, wait_key TEXT, resource TEXT,
 UNIQUE(run_id,position)
);
CREATE TABLE IF NOT EXISTS attempts(
 id TEXT PRIMARY KEY, step_id TEXT NOT NULL REFERENCES steps(id), generation INTEGER NOT NULL,
 owner TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','lost','cancelled')),
 lease_until INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
 result_json TEXT, failure_json TEXT, UNIQUE(step_id,generation)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_attempt ON attempts(step_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS resources(name TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id));
CREATE TABLE IF NOT EXISTS controller(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, lease_until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS operations(
 key TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL,
 intent_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','confirmed')),
 receipt_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions(
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), step_id TEXT NOT NULL REFERENCES steps(id),
 status TEXT NOT NULL CHECK(status IN ('applied_default','needs_external','answered')),
 body_json TEXT NOT NULL, answer TEXT, created_at INTEGER NOT NULL, answered_at INTEGER
);
CREATE TABLE IF NOT EXISTS artifacts(
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id), path TEXT NOT NULL,
 sha256 TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, entity TEXT NOT NULL, data_json TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS automations(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('interval','files','github')),
 interval_ms INTEGER NOT NULL CHECK(interval_ms>=100), next_at INTEGER NOT NULL,
 definition_json TEXT NOT NULL, last_error TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trigger_receipts(key TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id), work_id TEXT REFERENCES work_items(id), received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS provider_health(key TEXT PRIMARY KEY, until_at INTEGER NOT NULL, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recoveries(
 failed_run_id TEXT PRIMARY KEY REFERENCES runs(id), work_id TEXT NOT NULL UNIQUE REFERENCES work_items(id),
 diagnosis_work_id TEXT NOT NULL REFERENCES work_items(id),
 status TEXT NOT NULL CHECK(status IN ('diagnosing','repairing','resumed','unresolved')),
 repair_ids_json TEXT NOT NULL DEFAULT '[]', resumed_run_id TEXT REFERENCES runs(id)
);
CREATE INDEX IF NOT EXISTS due_steps ON steps(state,next_at);
CREATE INDEX IF NOT EXISTS attempts_lease ON attempts(status,lease_until);
CREATE INDEX IF NOT EXISTS recent_events ON events(at);
