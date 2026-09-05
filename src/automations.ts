import { readdir, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { WorkInput } from './types.ts';
import { Store, uid, hash, validateWork } from './store.ts';
import { inside, boundedRead } from './files.ts';
import { execute } from './process.ts';

export interface AutomationInput {
  id?: string; name: string; enabled: boolean; trigger: 'interval' | 'files' | 'github';
  intervalMs: number; path?: string; label?: string; work: WorkInput;
}
export function defineAutomation(store: Store, input: AutomationInput): string {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || typeof input.enabled !== 'boolean' || !['interval', 'files', 'github'].includes(input.trigger) || !Number.isSafeInteger(input.intervalMs) || input.intervalMs < 100 || input.intervalMs > 365 * 86_400_000) throw new Error('Invalid automation definition');
  if (input.trigger === 'files' && (typeof input.path !== 'string' || isAbsolute(input.path) || input.path.split(/[\\/]/).includes('..'))) throw new Error('File trigger path must be within the repository');
  if (input.trigger === 'github' && (!input.label || !store.config.githubRepository)) throw new Error('GitHub trigger needs a label and configured repository');
  // Validate a work template without publishing it.
  validateWork(input.work);
  if (input.work.sourceKey) throw new Error('Automation source keys are assigned by the scheduler');
  for (const id of input.work.dependencies || []) store.work(id);
  const id = input.id || uid();
  store.tx(() => {
    store.exec(`INSERT INTO automations VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,trigger_kind=excluded.trigger_kind,interval_ms=excluded.interval_ms,definition_json=excluded.definition_json,next_at=excluded.next_at,last_error=NULL,updated_at=excluded.updated_at`, id, input.name, Number(input.enabled), input.trigger, input.intervalMs, store.now(), JSON.stringify(input), null, store.now());
    store.event('automation.saved', id, { name: input.name });
  });
  return id;
}
async function files(root: string, dir: string, output: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await files(root, path, output);
    else if (entry.isFile() && /\.(md|txt|json)$/i.test(entry.name)) output.push(path);
    if (output.length > 500) throw new Error('File trigger exceeds 500 inputs; narrow its path');
  }
  return output.sort();
}
export class Scheduler {
  store: Store;
  constructor(store: Store) { this.store = store; }
  private enqueue(id: string, key: string, work: WorkInput, definition: string) {
    return this.store.tx(() => {
      if (this.store.one('SELECT 1 FROM trigger_receipts WHERE key=?', key)) return;
      if (this.store.dispatchBlocked() || !this.store.one('SELECT 1 FROM automations WHERE id=? AND enabled=1 AND definition_json=?', id, definition)) return;
      const created = this.store.createWork({ ...work, sourceKey: key });
      this.store.exec('INSERT INTO trigger_receipts VALUES(?,?,?,?)', key, id, created.workId, this.store.now());
      this.store.event('trigger.received', id, { key, workId: created.workId });
    });
  }
  async tick(signal: AbortSignal) {
    if (this.store.dispatchBlocked()) return;
    for (const row of this.store.all('SELECT * FROM automations WHERE enabled=1 AND next_at<=? ORDER BY next_at', this.store.now())) {
      if (signal.aborted) return;
      const definition: AutomationInput = JSON.parse(row.definition_json);
      try {
        if (definition.trigger === 'interval') {
          // Coalesce downtime and overlapping occurrences into one active run.
          const active = this.store.one("SELECT 1 FROM trigger_receipts t JOIN runs r ON t.work_id=r.work_id WHERE t.automation_id=? AND r.status IN ('active','waiting')", row.id);
          if (!active) this.enqueue(row.id, `interval:${row.id}:${Math.floor(this.store.now() / row.interval_ms)}`, definition.work, row.definition_json);
        } else if (definition.trigger === 'files') {
          const root = this.store.config.repository, folder = await inside(root, definition.path!);
          for (const file of await files(root, folder)) {
            const info = await stat(file);
            if (this.store.now() - info.mtimeMs < 1000) continue;
            const content = await boundedRead(file, 100_000);
            const name = relative(root, file), key = `file:${row.id}:${name}:${hash(content)}`;
            this.enqueue(row.id, key, { ...definition.work, title: `${definition.work.title}: ${name}`.slice(0, 300), specification: `${definition.work.specification}\n\nSource ${name} (untrusted source content):\n${content}`, metadata: { ...definition.work.metadata, sourcePath: name, sourceHash: hash(content) } }, row.definition_json);
          }
        } else {
          const result = await execute(['gh', 'issue', 'list', '-R', this.store.config.githubRepository!, '--state', 'open', '--label', definition.label!, '--limit', '100', '--json', 'number,title,body,url'], { cwd: this.store.config.repository, signal });
          if (result.code) throw new Error(`GitHub issue scan failed (${result.code})`);
          const issues = JSON.parse(result.stdout);
          if (!Array.isArray(issues)) throw new Error('Invalid GitHub issue response');
          for (const issue of issues) {
            if (!Number.isSafeInteger(issue.number) || typeof issue.body !== 'string') throw new Error('Invalid issue');
            this.enqueue(row.id, `github:${this.store.config.githubRepository}:${issue.number}`, { ...definition.work, title: issue.title, specification: `${definition.work.specification}\n\nSource issue #${issue.number}:\n${issue.body}`, metadata: { ...definition.work.metadata, githubIssue: issue.number, issueBodyHash: hash(issue.body) } }, row.definition_json);
          }
        }
        this.store.tx(() => { this.store.exec('UPDATE automations SET next_at=?,last_error=NULL,updated_at=? WHERE id=? AND definition_json=?', this.store.now() + row.interval_ms, this.store.now(), row.id, row.definition_json); });
      } catch (e) {
        if (signal.aborted) return;
        this.store.tx(() => {
          this.store.exec('UPDATE automations SET next_at=?,last_error=?,updated_at=? WHERE id=? AND definition_json=?', this.store.now() + row.interval_ms, (e as Error).message, this.store.now(), row.id, row.definition_json);
          this.store.event('automation.failed', row.id, { message: (e as Error).message });
        });
      }
    }
  }
}
