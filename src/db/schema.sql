CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'ready', 'in-progress', 'review', 'fix', 'done',
        'parked', 'merged', 'merged-unverified', 'merged-audited', 'manual-takeover'
    )),
    pr_number INTEGER,
    pr_url TEXT,
    base_branch TEXT NOT NULL DEFAULT 'main',
    branch_name TEXT NOT NULL DEFAULT '',
    base_oid TEXT,
    head_oid TEXT,
    attempt INTEGER DEFAULT 1,
    repair_count INTEGER DEFAULT 0,
    parked_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    ticket_id INTEGER REFERENCES tickets(id),
    role TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'timeout', 'cancelled')),
    model TEXT NOT NULL,
    variant TEXT NOT NULL,
    worktree_path TEXT,
    pgid INTEGER,
    exit_code INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    error_message TEXT,
    result_text TEXT
);

CREATE TABLE IF NOT EXISTS verdicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    session_id TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 1,
    head_oid TEXT NOT NULL DEFAULT '',
    verdict TEXT NOT NULL CHECK (verdict IN ('PASS', 'BLOCK')),
    task_status TEXT NOT NULL DEFAULT 'works',
    bench_status TEXT NOT NULL DEFAULT 'none',
    expected TEXT,
    observed TEXT,
    blockers_json TEXT DEFAULT '[]',
    advisories_json TEXT DEFAULT '[]',
    raw_markdown TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decision_cards (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT 'implement',
    status TEXT NOT NULL CHECK (status IN ('open', 'answered', 'dismissed')),
    ticket_id INTEGER REFERENCES tickets(id),
    question TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    options_json TEXT NOT NULL DEFAULT '[]',
    recommendation TEXT,
    selected_option TEXT,
    owner_note TEXT,
    answered_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS circuit_breaker (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'ok',
    model TEXT,
    role TEXT,
    reason TEXT,
    tripped_at TEXT,
    cooldown_until TEXT,
    retry_after_sec INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    entity_id TEXT,
    payload_json TEXT DEFAULT '{}',
    recorded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_state ON tickets(state);
CREATE INDEX IF NOT EXISTS idx_sessions_ticket ON sessions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_verdicts_ticket ON verdicts(ticket_id);
CREATE INDEX IF NOT EXISTS idx_decision_cards_status ON decision_cards(status);
