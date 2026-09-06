import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { Config } from './types.ts';

export function defaults(repository: string): Config {
  return {
    version: 1, repository: realpathSync(repository), baseBranch: 'main', integration: 'local',
    worker: { kind: 'opencode' }, checks: [],
    limits: { concurrency: 2, leaseMs: 30_000, attemptMs: 1_800_000, retryBaseMs: 30_000,
      maxAttempts: 3, maxRepairs: 3, dailyAttempts: 100, maxOutputBytes: 8_000_000 },
    server: { host: '127.0.0.1', port: 4188 }
  };
}
export function validateConfig(value: unknown): Config {
  const c = value as Config;
  if (!c || c.version !== 1 || !isAbsolute(c.repository ?? '') || !/^[\w./-]+$/.test(c.baseBranch ?? '') || c.baseBranch.includes('..') || c.baseBranch.startsWith('-')) throw new Error('Invalid repository or base branch');
  if (!['local', 'github'].includes(c.integration)) throw new Error('Invalid integration mode');
  if (c.integration === 'github' && !/^[\w.-]+\/[\w.-]+$/.test(c.githubRepository ?? '')) throw new Error('GitHub mode needs owner/repository');
  if (!c.worker || !['opencode', 'command'].includes(c.worker.kind)) throw new Error('Invalid worker');
  if (c.worker.timeoutMs !== undefined && (!Number.isSafeInteger(c.worker.timeoutMs) || c.worker.timeoutMs < 1000 || c.worker.timeoutMs > 86400000)) throw new Error('Invalid worker timeout');
  if (c.worker.kind === 'command' && !validCommand(c.worker.command)) throw new Error('Worker command must be an argv array');
  if (!Array.isArray(c.checks)) throw new Error('checks must be an array');
  const names = new Set();
  for (const check of c.checks) {
    if (!check.name || names.has(check.name) || !validCommand(check.command) || typeof check.cwd !== 'string' || isAbsolute(check.cwd) || check.cwd.split(/[\\/]/).includes('..') || !Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1) throw new Error('Invalid or duplicate check');
    if (check.setup !== undefined && typeof check.setup !== 'boolean') throw new Error('Invalid check setup flag');
    if (check.paths !== undefined && (!Array.isArray(check.paths) || check.paths.some(p => typeof p !== 'string' || !p || isAbsolute(p) || p.split('/').includes('..') || p.includes('\\')))) throw new Error('Invalid check paths');
    names.add(check.name);
  }
  for (const [key, min, max] of [
    ['concurrency', 1, 8], ['leaseMs', 300, 300_000], ['attemptMs', 100, 86_400_000],
    ['retryBaseMs', 1, 3_600_000], ['maxAttempts', 1, 10], ['maxRepairs', 0, 10],
    ['dailyAttempts', 1, 10_000], ['maxOutputBytes', 1024, 100_000_000]
  ] as const) {
    if (!Number.isSafeInteger(c.limits?.[key]) || c.limits[key] < min || c.limits[key] > max) throw new Error(`Invalid limit: ${key}`);
  }
  if (c.server?.host !== '127.0.0.1' || !Number.isSafeInteger(c.server.port) || c.server.port < 0 || c.server.port > 65535) throw new Error('Invalid loopback server');
  return c;
}
function validCommand(c: unknown): c is string[] { return Array.isArray(c) && c.length > 0 && c.every(x => typeof x === 'string' && x.length > 0); }
export function loadConfig(home: string): Config {
  const file = resolve(home, 'state.db');
  if (existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try { const row = db.prepare("SELECT value FROM settings WHERE key='runtime_config'").get(); if (row) return validateConfig(JSON.parse(String(row.value))); } finally { db.close(); }
  }
  return validateConfig(JSON.parse(readFileSync(resolve(home, 'config.json'), 'utf8')));
}
export function checkDigest(c: Config): string { return createHash('sha256').update(JSON.stringify(c.checks)).digest('hex'); }
