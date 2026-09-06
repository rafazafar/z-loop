import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Config, WorkInput, Step, Run, Attempt, Claim, StepResult, Proposal, StepKind } from './types.ts';
import { validateConfig } from './config.ts';
import { StepError } from './types.ts';

export const uid = () => randomUUID();
export const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const NEXT: Partial<Record<StepKind, StepKind>> = { implement: 'verify', verify: 'review', review: 'publish', publish: 'integrate', integrate: 'observe', plan: 'check_plan', check_plan: 'apply_plan' };
export function validateWork(input: WorkInput) {
    if (!input || (input.dependencies !== undefined && (!Array.isArray(input.dependencies) || input.dependencies.some(x => typeof x !== 'string')))) throw new Error('Invalid work or dependencies');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300 || typeof input.specification !== 'string' || !input.specification.trim() || input.specification.length > 100_000 || !Array.isArray(input.acceptance) || !input.acceptance.length || input.acceptance.length > 30 || input.acceptance.some(x => typeof x !== 'string' || !x.trim() || x.length > 4000)) throw new Error('Work needs a title, specification, and 1–30 acceptance criteria');
    if (input.workflow && !['code', 'plan'].includes(input.workflow)) throw new Error('Unknown workflow');
    if (input.priority !== undefined && (!Number.isInteger(input.priority) || Math.abs(input.priority) > 100)) throw new Error('Priority must be between -100 and 100');
}
export class Store {
  db: DatabaseSync;
  config: Config;
  now: () => number;
  private depth = 0;
  constructor(file: string, config: Config, now: () => number = Date.now) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.config = config; this.now = now;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    if (this.one<{ version: number }>('SELECT max(version) AS version FROM schema_version')?.version !== 1) throw new Error('Unsupported database schema');
    const saved = this.one("SELECT value FROM settings WHERE key='runtime_config'");
    if (saved) Object.assign(this.config, validateConfig(JSON.parse(saved.value)));
    else this.exec("INSERT INTO settings VALUES('runtime_config',?)", JSON.stringify(config));
  }
  close() { this.db.close(); }
  one<T = Record<string, any>>(sql: string, ...args: any[]): T | undefined { return this.db.prepare(sql).get(...args) as T | undefined; }
  all<T = Record<string, any>>(sql: string, ...args: any[]): T[] { return this.db.prepare(sql).all(...args) as T[]; }
  exec(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }
  tx<T>(fn: () => T): T {
    if (this.depth) return fn();
    this.db.exec('BEGIN IMMEDIATE'); this.depth++;
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
    finally { this.depth--; }
  }
  event(type: string, entity: string, data: unknown = {}) { this.exec('INSERT INTO events(type,entity,data_json,at) VALUES(?,?,?,?)', type, entity, JSON.stringify(data), this.now()); }
  createWork(input: WorkInput): { workId: string; runId: string; created: boolean } {
    validateWork(input);
    return this.tx(() => {
      const source = input.sourceKey || `manual:${uid()}`;
      const existing = this.one('SELECT id FROM work_items WHERE source_key=?', source);
      if (existing) return { workId: existing.id, runId: this.one('SELECT id FROM runs WHERE work_id=? ORDER BY revision DESC LIMIT 1', existing.id)!.id, created: false };
      const id = uid(), run = uid(), workflow = input.workflow || 'code';
      this.exec('INSERT INTO work_items VALUES(?,?,?,?,?,?,?,?,?)', id, source, input.title, input.specification, JSON.stringify(input.acceptance), workflow, input.priority || 0, JSON.stringify(input.metadata || {}), this.now());
      for (const dep of input.dependencies || []) {
        if (!this.one('SELECT id FROM work_items WHERE id=?', dep)) throw new Error(`Unknown dependency: ${dep}`);
        this.exec('INSERT INTO dependencies VALUES(?,?)', id, dep);
      }
      this.exec('INSERT INTO runs(id,work_id,revision,status,created_at) VALUES(?,?,1,?,?)', run, id, 'active', this.now());
      this.addStep(run, workflow === 'code' ? 'implement' : 'plan');
      this.event('work.created', id, { run, source, workflow });
      return { workId: id, runId: run, created: true };
    });
  }
  work(id: string): WorkInput & { id: string } {
    const w = this.one('SELECT * FROM work_items WHERE id=?', id);
    if (!w) throw new Error('Unknown work item');
    return { id: w.id, title: w.title, specification: w.specification, acceptance: JSON.parse(w.acceptance_json), sourceKey: w.source_key, workflow: w.workflow, priority: w.priority, metadata: JSON.parse(w.metadata_json) };
  }
  addStep(run: string, kind: StepKind, input: unknown = {}) {
    const id = uid(); const position = this.one('SELECT coalesce(max(position),0)+1 AS n FROM steps WHERE run_id=?', run)!.n;
    this.exec('INSERT INTO steps(id,run_id,kind,state,position,input_json,next_at,resource) VALUES(?,?,?,?,?,?,?,?)', id, run, kind, 'queued', position, JSON.stringify(input), this.now(), kind === 'integrate' ? 'repository:integration' : `run:${run}`);
    return id;
  }
  acquireController(owner: string): boolean {
    return this.tx(() => {
      const lock = this.one('SELECT * FROM controller WHERE id=1');
      if (lock && lock.owner !== owner && lock.lease_until > this.now()) return false;
      this.exec('INSERT INTO controller VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until', owner, this.now() + this.config.limits.leaseMs);
      return true;
    });
  }
  releaseController(owner: string) { this.exec('DELETE FROM controller WHERE owner=?', owner); }
  isOwner(owner: string) { return !!this.one('SELECT 1 FROM controller WHERE owner=? AND lease_until>?', owner, this.now()); }
  setPaused(paused: boolean) { this.tx(() => { this.exec("UPDATE settings SET value=? WHERE key='paused'", JSON.stringify(paused)); this.event('controller.paused', 'controller', { paused }); }); }
  dispatchBlocked() {
    return this.one("SELECT value FROM settings WHERE key='paused'")?.value === 'true' || !!this.one("SELECT 1 FROM settings WHERE key='pending_config' OR (key='maintenance_until' AND CAST(value AS INTEGER)>?)", this.now());
  }
  claim(owner: string, admission?: (modelStep: boolean) => boolean): Claim | null {
    return this.tx(() => {
      if (!this.isOwner(owner) || this.dispatchBlocked()) return null;
      if (this.one("SELECT count(*) AS n FROM attempts WHERE status='running'")!.n >= this.config.limits.concurrency) return null;
      this.exec("UPDATE steps SET state='queued',wait_kind=NULL,wait_key=NULL WHERE state='waiting' AND wait_kind NOT IN ('external','dependency') AND next_at<=?", this.now());
      const unmet = `EXISTS(SELECT 1 FROM dependencies d JOIN runs r ON r.work_id=d.work_id WHERE r.id=steps.run_id AND NOT EXISTS(SELECT 1 FROM runs dr WHERE dr.work_id=d.requires_id AND dr.status='succeeded' AND dr.revision=(SELECT max(revision) FROM runs WHERE work_id=d.requires_id)))`;
      this.exec(`UPDATE steps SET state='waiting',wait_kind='dependency',error='A required work item has not completed' WHERE state IN ('queued','retry_scheduled') AND ${unmet}`);
      this.exec(`UPDATE steps SET state='queued',wait_kind=NULL,error=NULL WHERE state='waiting' AND wait_kind='dependency' AND NOT ${unmet}`);
      const day = this.now() - 86_400_000;
      const paidToday = this.one("SELECT count(*) AS n FROM attempts a JOIN steps s ON s.id=a.step_id WHERE a.started_at>=? AND s.kind IN ('implement','review','plan','check_plan','resolve')", day)!.n;
      const steps = this.all<Step>(`SELECT s.* FROM steps s JOIN runs r ON r.id=s.run_id JOIN work_items w ON w.id=r.work_id
        WHERE s.state IN ('queued','retry_scheduled') AND s.next_at<=? AND r.status='active'
        AND NOT EXISTS(SELECT 1 FROM steps prior WHERE prior.run_id=s.run_id AND prior.position<s.position AND prior.state NOT IN ('succeeded','rejected'))
        AND NOT EXISTS(SELECT 1 FROM dependencies d WHERE d.work_id=w.id AND NOT EXISTS(SELECT 1 FROM runs dr WHERE dr.work_id=d.requires_id AND dr.status='succeeded' AND dr.revision=(SELECT max(revision) FROM runs WHERE work_id=d.requires_id)))
        ORDER BY (w.priority + ((? - w.created_at) / 3600000)) DESC,w.created_at,s.position`, this.now(), this.now());
      for (const step of steps) {
        const modelStep = ['implement', 'review', 'plan', 'check_plan', 'resolve'].includes(step.kind);
        if (admission && !admission(modelStep)) continue;
        if (modelStep && paidToday >= this.config.limits.dailyAttempts) {
          const first = this.one("SELECT min(a.started_at) AS at FROM attempts a JOIN steps s ON a.step_id=s.id WHERE a.started_at>=? AND s.kind IN ('implement','review','plan','check_plan','resolve')", day)!.at;
          this.exec("UPDATE steps SET state='waiting',wait_kind='budget',error='Daily model attempt budget reached',next_at=? WHERE id=?", first + 86_400_001, step.id); continue;
        }
        const provider = modelStep && this.one('SELECT until_at,reason FROM provider_health WHERE key=? AND until_at>?', 'worker', this.now());
        if (provider) { this.exec("UPDATE steps SET state='waiting',wait_kind='provider',error=?,next_at=? WHERE id=?", provider.reason, provider.until_at, step.id); continue; }
        const resources = [...new Set([`run:${step.run_id}`, step.resource!])];
        if (resources.some(r => this.one('SELECT 1 FROM resources WHERE name=?', r))) continue;
        const attemptId = uid(), gen = step.generation + 1;
        this.exec("UPDATE steps SET state='running',generation=?,attempt_count=attempt_count+1,error=NULL,wait_kind=NULL,wait_key=NULL WHERE id=?", gen, step.id);
        this.exec('INSERT INTO attempts(id,step_id,generation,owner,status,lease_until,started_at) VALUES(?,?,?,?,?,?,?)', attemptId, step.id, gen, owner, 'running', this.now() + this.config.limits.leaseMs, this.now());
        for (const resource of resources) this.exec('INSERT INTO resources VALUES(?,?)', resource, attemptId);
        this.event('attempt.started', attemptId, { step: step.id, kind: step.kind, generation: gen });
        const run = this.one<Run>('SELECT * FROM runs WHERE id=?', step.run_id)!;
        return { step: this.one<Step>('SELECT * FROM steps WHERE id=?', step.id)!, run, attempt: this.one<Attempt>('SELECT * FROM attempts WHERE id=?', attemptId)!, work: this.work(run.work_id) };
      }
      return null;
    });
  }
  current(attemptId: string, owner: string): boolean {
    return !!this.one(`SELECT 1 FROM attempts a JOIN steps s ON s.id=a.step_id WHERE a.id=? AND a.owner=? AND a.status='running' AND s.state='running' AND s.generation=a.generation AND a.lease_until>?`, attemptId, owner, this.now()) && this.isOwner(owner);
  }
  heartbeat(attemptId: string, owner: string): boolean {
    return this.tx(() => {
      if (!this.current(attemptId, owner)) return false;
      this.exec('UPDATE attempts SET lease_until=? WHERE id=?', this.now() + this.config.limits.leaseMs, attemptId); return true;
    });
  }
  complete(claim: Claim, result: StepResult): boolean {
    return this.tx(() => {
      if (!this.current(claim.attempt.id, claim.attempt.owner)) return false;
      const { step } = claim; const run = this.one<Run>('SELECT * FROM runs WHERE id=?', step.run_id)!;
      const context = { ...JSON.parse(run.context_json), ...result.context };
      this.exec("UPDATE attempts SET status='succeeded',ended_at=?,result_json=? WHERE id=?", this.now(), JSON.stringify(result), claim.attempt.id);
      this.exec('DELETE FROM resources WHERE attempt_id=?', claim.attempt.id);
      this.exec("UPDATE steps SET state='succeeded',result_json=? WHERE id=?", JSON.stringify(result), step.id);
      this.exec('UPDATE runs SET context_json=? WHERE id=?', JSON.stringify(context), run.id);
      if (result.artifact) this.exec('INSERT INTO artifacts VALUES(?,?,?,?,?,?)', uid(), claim.attempt.id, result.artifact.path, result.artifact.sha256, result.artifact.kind, this.now());
      this.event(result.repair ? 'step.rejected' : 'step.succeeded', step.id, { summary: result.summary });
      if (result.repair) { this.exec("UPDATE steps SET state='rejected' WHERE id=?", step.id); this.repair(run, result.repair); return true; }
      if (result.need) {
        if (step.kind !== 'resolve') {
          this.addStep(run.id, 'resolve', { need: result.need, resume: step.kind });
        } else {
          const decision = uid();
          this.exec('INSERT INTO decisions(id,run_id,step_id,status,body_json,created_at) VALUES(?,?,?,?,?,?)', decision, run.id, step.id, 'needs_external', JSON.stringify(result.need), this.now());
          this.exec("UPDATE steps SET state='waiting',wait_kind='external',wait_key=? WHERE id=?", decision, step.id);
          this.exec("UPDATE runs SET status='waiting' WHERE id=?", run.id);
          this.event('decision.required', decision, result.need);
        }
        return true;
      }
      if (result.defaultChoice) {
        this.exec('INSERT INTO decisions(id,run_id,step_id,status,body_json,created_at) VALUES(?,?,?,?,?,?)', uid(), run.id, step.id, 'applied_default', JSON.stringify(result.defaultChoice), this.now());
        context.pendingRefinements = [...(context.pendingRefinements || []), result.defaultChoice.refinement];
        this.exec('UPDATE runs SET context_json=? WHERE id=?', JSON.stringify(context), run.id);
        const input = JSON.parse(step.input_json);
        this.addStep(run.id, input.resume || 'implement', { feedback: result.defaultChoice.choice });
        return true;
      }
      if (result.advisories?.length) this.publishProposals(run.id, result.advisories, 'advisory');
      if (step.kind === 'apply_plan') {
        const ids = this.publishProposals(run.id, result.proposals || [], 'plan');
        this.exec("UPDATE recoveries SET status=?,repair_ids_json=? WHERE diagnosis_work_id=? AND status='diagnosing'", ids.length ? 'repairing' : 'unresolved', JSON.stringify(ids), run.work_id);
      }
      const next = NEXT[step.kind];
      if (next) this.addStep(run.id, next);
      else {
        this.exec("UPDATE runs SET status='succeeded',finished_at=? WHERE id=?", this.now(), run.id);
        if (context.pendingRefinements?.length) this.publishProposals(run.id, context.pendingRefinements, 'refinement');
        this.event('run.succeeded', run.id);
      }
      return true;
    });
  }
  private repair(run: Run, findings: string[]) {
    if (run.repair_count >= this.config.limits.maxRepairs) { this.terminalFailure(run, 'Repair budget exhausted', findings); return; }
    this.exec('UPDATE runs SET repair_count=repair_count+1 WHERE id=?', run.id);
    this.addStep(run.id, this.work(run.work_id).workflow === 'plan' ? 'plan' : 'implement', { feedback: findings.join('\n') });
    this.event('repair.scheduled', run.id, { findings });
  }
  fail(claim: Claim, error: StepError, lost = false): boolean {
    return this.tx(() => {
      const a = this.one<Attempt>('SELECT * FROM attempts WHERE id=?', claim.attempt.id);
      if (!a || a.status !== 'running' || (!lost && !this.current(a.id, a.owner))) return false;
      const step = this.one<Step>('SELECT * FROM steps WHERE id=?', a.step_id)!;
      if (step.generation !== a.generation) return false;
      this.exec('UPDATE attempts SET status=?,ended_at=?,failure_json=? WHERE id=?', lost ? 'lost' : 'failed', this.now(), JSON.stringify({ category: error.category, message: error.message, details: error.details }), a.id);
      this.exec('DELETE FROM resources WHERE attempt_id=?', a.id);
      this.exec('UPDATE steps SET failure_class=?,error=? WHERE id=?', error.category, error.message, step.id);
      this.event('attempt.failed', a.id, { category: error.category, message: error.message, lost });
      if (['verification', 'review', 'revision'].includes(error.category)) {
        this.exec("UPDATE steps SET state='rejected',result_json=? WHERE id=?", JSON.stringify({ routedToRepair: true, failure: error.message }), step.id);
        this.repair(this.one<Run>('SELECT * FROM runs WHERE id=?', step.run_id)!, [error.message]);
      } else if (this.one("SELECT count(*) AS n FROM attempts WHERE step_id=? AND status IN ('failed','lost')", step.id)!.n < this.config.limits.maxAttempts && error.category !== 'cancelled') {
        const failures = this.one("SELECT count(*) AS n FROM attempts WHERE step_id=? AND status IN ('failed','lost')", step.id)!.n;
        const delay = Math.min(this.config.limits.retryBaseMs * 2 ** (failures - 1), 3_600_000);
        const next = this.now() + delay + Math.floor(delay * 0.2 * Math.random());
        this.exec("UPDATE steps SET state='retry_scheduled',next_at=?,wait_kind='retry' WHERE id=?", next, step.id);
        if (error.category === 'provider') this.exec('INSERT INTO provider_health VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET until_at=excluded.until_at,reason=excluded.reason', 'worker', next, error.message);
      } else {
        this.exec("UPDATE steps SET state='failed' WHERE id=?", step.id);
        this.terminalFailure(this.one<Run>('SELECT * FROM runs WHERE id=?', step.run_id)!, error.message, [error.category]);
      }
      return true;
    });
  }
  private terminalFailure(run: Run, message: string, details: string[]) {
    this.exec("UPDATE runs SET status='failed',finished_at=? WHERE id=?", this.now(), run.id);
    this.event('run.failed', run.id, { message, details });
    const work = this.work(run.work_id);
    if (!work.metadata?.recovery && !this.one('SELECT 1 FROM recoveries WHERE work_id=?', work.id)) {
      const diagnosis = this.createWork({ title: `Diagnose: ${work.title}`.slice(0, 300), specification: `Diagnose this failed work. Propose at most one bounded repair. Do not repeat the failed approach without new evidence.\nOriginal: ${work.specification}\nFailure: ${message}\nDetails: ${details.join('; ')}`.slice(0, 100_000), acceptance: ['Identify a cause from evidence and propose a bounded repair, or explain why no automatic repair is possible.'], workflow: 'plan', sourceKey: `recovery:${run.id}`, priority: 100, metadata: { recovery: true, failedRun: run.id } });
      this.exec('INSERT INTO recoveries(failed_run_id,work_id,diagnosis_work_id,status) VALUES(?,?,?,?)', run.id, work.id, diagnosis.workId, 'diagnosing');
    }
  }
  reconcileRecovery() {
    this.tx(() => {
      for (const recovery of this.all("SELECT * FROM recoveries WHERE status IN ('diagnosing','repairing')")) {
        const ids = recovery.status === 'diagnosing' ? [recovery.diagnosis_work_id] : JSON.parse(recovery.repair_ids_json);
        const statuses = ids.map((id: string) => this.one('SELECT status FROM runs WHERE work_id=? ORDER BY revision DESC LIMIT 1', id)?.status);
        if (statuses.some((s: string) => ['failed', 'cancelled'].includes(s))) {
          this.exec("UPDATE recoveries SET status='unresolved' WHERE failed_run_id=?", recovery.failed_run_id);
          this.event('recovery.unresolved', recovery.failed_run_id);
        } else if (recovery.status === 'repairing' && statuses.length && statuses.every((s: string) => s === 'succeeded')) {
          const latest = this.one('SELECT id,status FROM runs WHERE work_id=? ORDER BY revision DESC LIMIT 1', recovery.work_id)!;
          if (latest.id !== recovery.failed_run_id) { this.exec("UPDATE recoveries SET status='resumed',resumed_run_id=? WHERE failed_run_id=?", latest.id, recovery.failed_run_id); continue; }
          const resumed = this.rerun(recovery.work_id);
          this.exec("UPDATE recoveries SET status='resumed',resumed_run_id=? WHERE failed_run_id=?", resumed, recovery.failed_run_id);
          this.event('recovery.resumed', recovery.failed_run_id, { runId: resumed });
        }
      }
    });
  }
  expired(): Claim[] {
    return this.all<Attempt>("SELECT * FROM attempts WHERE status='running' AND lease_until<=?", this.now()).map(attempt => {
      const step = this.one<Step>('SELECT * FROM steps WHERE id=?', attempt.step_id)!;
      const run = this.one<Run>('SELECT * FROM runs WHERE id=?', step.run_id)!;
      return { attempt, step, run, work: this.work(run.work_id) };
    });
  }
  defer(claim: Claim, kind: string, reason: string, delayMs: number) {
    return this.tx(() => {
      if (!this.current(claim.attempt.id, claim.attempt.owner)) return false;
      this.exec("UPDATE attempts SET status=?,ended_at=?,result_json=? WHERE id=?", kind === 'restart' ? 'cancelled' : 'succeeded', this.now(), JSON.stringify({ waiting: kind, reason }), claim.attempt.id);
      this.exec('DELETE FROM resources WHERE attempt_id=?', claim.attempt.id);
      this.exec("UPDATE steps SET state='waiting',wait_kind=?,error=?,next_at=? WHERE id=?", kind, reason, this.now() + delayMs, claim.step.id);
      this.event('step.waiting', claim.step.id, { kind, reason, nextAt: this.now() + delayMs }); return true;
    });
  }
  answer(id: string, answer: string) {
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 20_000) throw new Error('A bounded answer is required');
    this.tx(() => {
      const d = this.one("SELECT * FROM decisions WHERE id=? AND status='needs_external'", id);
      if (!d) throw new Error('No open external decision');
      const s = this.one<Step>('SELECT * FROM steps WHERE id=?', d.step_id)!;
      if (this.one('SELECT status FROM runs WHERE id=?', d.run_id)?.status !== 'waiting') throw new Error('Run is not waiting');
      this.exec("UPDATE decisions SET status='answered',answer=?,answered_at=? WHERE id=?", answer, this.now(), id);
      this.exec("UPDATE steps SET state='succeeded',wait_kind=NULL,wait_key=NULL WHERE id=?", s.id);
      this.exec("UPDATE runs SET status='active' WHERE id=?", d.run_id);
      this.addStep(d.run_id, JSON.parse(s.input_json).resume || 'implement', { feedback: answer });
      this.event('decision.answered', id);
    });
  }
  cancel(runId: string) {
    this.tx(() => {
      if (!this.one("SELECT 1 FROM runs WHERE id=? AND status IN ('active','waiting')", runId)) throw new Error('No active run');
      const attempts = this.all("SELECT a.id FROM attempts a JOIN steps s ON a.step_id=s.id WHERE s.run_id=? AND a.status='running'", runId);
      for (const a of attempts) { this.exec("UPDATE attempts SET status='cancelled',ended_at=? WHERE id=?", this.now(), a.id); this.exec('DELETE FROM resources WHERE attempt_id=?', a.id); }
      this.exec("UPDATE steps SET state='cancelled',generation=generation+1 WHERE run_id=? AND state IN ('queued','running','waiting','retry_scheduled')", runId);
      this.exec("UPDATE runs SET status='cancelled',finished_at=? WHERE id=?", this.now(), runId); this.event('run.cancelled', runId);
    });
  }
  rerun(workId: string) {
    return this.tx(() => {
      const work = this.work(workId);
      if (this.one("SELECT id FROM runs WHERE work_id=? AND status IN ('active','waiting')", workId)) throw new Error('Work already has an active run');
      const revision = this.one('SELECT max(revision)+1 AS n FROM runs WHERE work_id=?', workId)!.n, id = uid();
      this.exec('INSERT INTO runs(id,work_id,revision,status,created_at) VALUES(?,?,?,?,?)', id, workId, revision, 'active', this.now());
      this.addStep(id, work.workflow === 'plan' ? 'plan' : 'implement'); this.event('run.restarted', id, { workId, revision }); return id;
    });
  }
  publishProposals(runId: string, proposals: Proposal[], scope: string) {
    const ids = new Map<string, string>();
    const run = this.one<Run>('SELECT * FROM runs WHERE id=?', runId)!;
    const parent = this.work(run.work_id);
    const pending = [...proposals];
    while (pending.length) {
      const i = pending.findIndex(p => (p.dependsOn || []).every(d => ids.has(d)));
      if (i < 0) throw new Error('Proposal dependencies contain a cycle or missing key');
      const [p] = pending.splice(i, 1);
      const result = this.createWork({ ...p, sourceKey: `${scope}:${run.work_id}:${p.key}`, dependencies: (p.dependsOn || []).map(d => ids.get(d)!), priority: parent.metadata?.recovery ? 90 : scope === 'plan' ? 0 : -20, metadata: { parentRun: runId, recovery: !!parent.metadata?.recovery } });
      ids.set(p.key, result.workId);
    }
    return [...ids.values()];
  }
  operation(claim: Claim, key: string, kind: string, intent: unknown) {
    return this.tx(() => {
      if (!this.current(claim.attempt.id, claim.attempt.owner)) throw new StepError('cancelled', 'Attempt lost ownership');
      const old = this.one('SELECT * FROM operations WHERE key=?', key);
      if (old && old.intent_json !== JSON.stringify(intent)) throw new StepError('contract', 'Operation key reused with different input');
      if (!old) this.exec('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?)', key, claim.run.id, kind, JSON.stringify(intent), 'pending', null, this.now(), this.now());
      return old;
    });
  }
  confirmOperation(claim: Claim, key: string, receipt: unknown) {
    this.tx(() => {
      if (!this.current(claim.attempt.id, claim.attempt.owner)) throw new StepError('cancelled', 'Attempt lost ownership');
      this.exec("UPDATE operations SET status='confirmed',receipt_json=?,updated_at=? WHERE key=?", JSON.stringify(receipt), this.now(), key);
      this.event('operation.confirmed', key);
    });
  }
  eventHistory(search = '', offset = 0) {
    if(typeof search!=='string'||search.length>1000||!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid event query');
    const where="WHERE (?='' OR instr(lower(type || ' ' || entity || ' ' || data_json),lower(?))>0)";
    return {total:this.one(`SELECT count(*) AS n FROM events ${where}`,search,search)!.n,offset,limit:50,
      events:this.all(`SELECT * FROM events ${where} ORDER BY id DESC LIMIT 50 OFFSET ?`,search,search,offset)};
  }
  operational() {
    const latest = "r.revision=(SELECT max(revision) FROM runs WHERE work_id=r.work_id)";
    return {
      running: this.one("SELECT count(*) AS n FROM attempts WHERE status='running'")!.n,
      queued: this.one(`SELECT count(*) AS n FROM runs r WHERE ${latest} AND r.status='active' AND NOT EXISTS(SELECT 1 FROM steps s WHERE s.run_id=r.id AND s.state='running')`)!.n,
      failed: this.one(`SELECT count(*) AS n FROM runs r WHERE ${latest} AND r.status='failed'`)!.n,
      waiting: this.one(`SELECT count(*) AS n FROM runs r WHERE ${latest} AND r.status IN ('active','waiting') AND EXISTS(SELECT 1 FROM steps s WHERE s.run_id=r.id AND s.state IN ('waiting','retry_scheduled'))`)!.n,
      decisions: this.one("SELECT count(*) AS n FROM decisions WHERE status='needs_external'")!.n,
      oldestOpen: this.one(`SELECT min(w.created_at) AS at FROM work_items w JOIN runs r ON r.work_id=w.id WHERE ${latest} AND r.status IN ('active','waiting')`)!.at,
    };
  }
  history(search = '', status = 'all', offset = 0, limit = 50) {
    if (typeof search !== 'string' || search.length > 1000 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid history query');
    const states = ['all','open','active','waiting','succeeded','failed','cancelled','queued','running','retry_scheduled'];
    if (!states.includes(status)) throw new Error('Invalid work state');
    const filter = status === 'all' ? '1' : status === 'waiting' ? "r.status IN ('active','waiting') AND s.state='waiting'" : status === 'open' ? "r.status IN ('active','waiting')" : ['queued','running','retry_scheduled'].includes(status) ? "r.status='active' AND s.state=?" : 'r.status=?';
    const args = [search, search, ...(['all','open','waiting'].includes(status) ? [] : [status])];
    const from = `FROM work_items w JOIN runs r ON r.work_id=w.id LEFT JOIN steps s ON s.id=(SELECT id FROM steps WHERE run_id=r.id ORDER BY position DESC LIMIT 1)
      WHERE r.revision=(SELECT max(revision) FROM runs WHERE work_id=w.id) AND (?='' OR instr(lower(w.id || ' ' || w.title || ' ' || w.specification),lower(?))>0) AND ${filter}`;
    return { total: this.one(`SELECT count(*) AS n ${from}`, ...args)!.n, offset, limit,
      work: this.all(`SELECT w.*,r.id AS run_id,r.status,r.revision,r.repair_count,s.kind AS step_kind,s.state AS step_state,s.attempt_count AS step_attempt_count,s.wait_kind,s.error,s.next_at ${from}
        ORDER BY (r.status IN ('active','waiting')) DESC,w.priority DESC,w.created_at DESC,w.id LIMIT ? OFFSET ?`, ...args, limit, offset) };
  }
  snapshot() {
    return this.tx(() => ({
      operational: this.operational(),
      paused: this.one("SELECT value FROM settings WHERE key='paused'")?.value === 'true',
      metrics: this.all(`SELECT r.status,count(*) AS count FROM runs r WHERE r.revision=(SELECT max(revision) FROM runs WHERE work_id=r.work_id) GROUP BY r.status`),
      budgetUsed: this.one("SELECT count(*) AS n FROM attempts a JOIN steps s ON s.id=a.step_id WHERE a.started_at>=? AND s.kind IN ('implement','review','plan','check_plan','resolve')", this.now()-86400000)!.n,
      controller: this.one('SELECT owner,lease_until FROM controller WHERE id=1') || null,
      work: this.all(`SELECT w.*,r.id AS run_id,r.status,r.revision,r.repair_count FROM work_items w JOIN runs r ON r.work_id=w.id WHERE r.revision=(SELECT max(revision) FROM runs WHERE work_id=w.id) ORDER BY (r.status IN ('active','waiting')) DESC,w.created_at DESC LIMIT 200`),
      steps: this.all('SELECT * FROM steps ORDER BY rowid DESC LIMIT 500'),
      attempts: this.all('SELECT * FROM attempts ORDER BY started_at DESC LIMIT 100'),
      decisions: this.all("SELECT * FROM decisions ORDER BY (status='needs_external') DESC,created_at DESC LIMIT 500"),
      events: this.all('SELECT * FROM events ORDER BY id DESC LIMIT 100'),
      automations: this.all('SELECT * FROM automations ORDER BY name'),
      dependencies: this.all('SELECT * FROM dependencies'),
      providers: this.all('SELECT * FROM provider_health WHERE until_at>?', this.now()),
      recoveries: this.all('SELECT * FROM recoveries')
    }));
  }
  detail(id: string) {
    const work = this.one('SELECT * FROM work_items WHERE id=?', id);
    if (!work) throw new Error('Unknown work item');
    return { work, runs: this.all('SELECT * FROM runs WHERE work_id=? ORDER BY revision DESC', id),
      steps: this.all('SELECT s.* FROM steps s JOIN runs r ON r.id=s.run_id WHERE r.work_id=? ORDER BY s.position', id),
      attempts: this.all('SELECT a.* FROM attempts a JOIN steps s ON s.id=a.step_id JOIN runs r ON r.id=s.run_id WHERE r.work_id=? ORDER BY a.started_at', id),
      artifacts: this.all('SELECT ar.* FROM artifacts ar JOIN attempts a ON a.id=ar.attempt_id JOIN steps s ON s.id=a.step_id JOIN runs r ON r.id=s.run_id WHERE r.work_id=?', id) };
  }
  async backup(file: string) { await backup(this.db, file); }
}
