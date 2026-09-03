import { LoopDatabase } from '../db/index.ts';

export interface CircuitBreakerState {
  status: 'ok' | 'tripped';
  model?: string;
  role?: string;
  reason?: string;
  cooldownUntil?: string;
  retryAfterSec?: number;
}

export function detectRateLimit(logContent: string): { isRateLimited: boolean; retryAfterSec: number } {
  const is429 = /429|quota|rate limit|too many requests/i.test(logContent);
  if (!is429) return { isRateLimited: false, retryAfterSec: 0 };

  const match = logContent.match(/reset after (\d+)s/i) || logContent.match(/"retry-after":\s*"?(\d+)"?/i);
  let retrySec = match ? parseInt(match[1], 10) : 180;
  if (isNaN(retrySec) || retrySec < 60) retrySec = 60;

  return { isRateLimited: true, retryAfterSec: retrySec };
}

export function checkCircuitBreaker(db: LoopDatabase): CircuitBreakerState {
  const stmt = db.db.prepare('SELECT * FROM circuit_breaker WHERE id = 1');
  const row = stmt.get() as any;
  if (!row || row.status !== 'tripped') return { status: 'ok' };

  const now = new Date().toISOString();
  if (row.cooldown_until && now >= row.cooldown_until) {
    // Cooldown expired
    db.db.prepare('UPDATE circuit_breaker SET status = "ok" WHERE id = 1').run();
    return { status: 'ok' };
  }

  return {
    status: 'tripped',
    model: row.model,
    role: row.role,
    reason: row.reason,
    cooldownUntil: row.cooldown_until,
    retryAfterSec: row.retry_after_sec
  };
}

export function tripCircuitBreaker(
  db: LoopDatabase,
  model: string,
  role: string,
  reason: string,
  retryAfterSec: number
): void {
  const cooldownUntil = new Date(Date.now() + retryAfterSec * 1000).toISOString();
  db.db.prepare(`
    INSERT INTO circuit_breaker (id, status, model, role, reason, tripped_at, cooldown_until, retry_after_sec)
    VALUES (1, 'tripped', ?, ?, ?, datetime('now'), ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'tripped',
      model = excluded.model,
      role = excluded.role,
      reason = excluded.reason,
      tripped_at = datetime('now'),
      cooldown_until = excluded.cooldown_until,
      retry_after_sec = excluded.retry_after_sec
  `).run(model, role, reason, cooldownUntil, retryAfterSec);
}
