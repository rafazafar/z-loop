import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Store, uid, hash } from './store.ts';
import type { Claim, StepResult } from './types.ts';
import { StepError, WaitError } from './types.ts';
import { atomic, jsonFile, inside, sha256, boundedRead, redact } from './files.ts';
import { applyConfiguration } from './settings.ts';
import { Scheduler } from './automations.ts';

export interface Executor { run(claim: Claim, signal: AbortSignal): Promise<StepResult> }
interface SavedResult { attempt: string; generation: number; result: StepResult; digest: string }
export class Controller {
  store: Store; home: string; executor: Executor; owner = uid();
  private active = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private shuttingDown = false;
  private scheduler: Scheduler;
  private abort = new AbortController();
  lastError: string | null = null;
  constructor(store: Store, home: string, executor: Executor) { this.store = store; this.home = home; this.executor = executor; this.scheduler = new Scheduler(store); }
  async start() {
    if (!this.store.acquireController(this.owner)) throw new Error('Another controller owns this database');
    await this.tick();
    this.resetTimer();
  }
  private resetTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick().catch(e => { this.lastError = (e as Error).message; }), Math.max(50, Math.min(1000, this.store.config.limits.leaseMs / 4)));
  }
  async tick() {
    if (this.ticking || this.shuttingDown) return;
    this.ticking = true;
    try {
      if (!this.store.acquireController(this.owner)) {
        for (const { abort } of this.active.values()) abort.abort();
        throw new Error('Controller lease was lost');
      }
      for (const claim of this.store.expired()) await this.recover(claim);
      this.store.reconcileRecovery();
      if (!this.active.size && !this.scan && applyConfiguration(this.store)) this.resetTimer();
      // Discovery must not block lease renewal while a remote scan is slow.
      this.scheduleScan();
      while (!this.shuttingDown) {
        const claim = this.store.claim(this.owner);
        if (!claim) break;
        const abort = new AbortController();
        const promise = this.run(claim, abort).catch(e => { this.lastError = (e as Error).message; }).finally(() => this.active.delete(claim.attempt.id));
        this.active.set(claim.attempt.id, { abort, promise });
      }
      this.lastError = null;
    } finally { this.ticking = false; }
  }
  private scan?: Promise<void>;
  private scheduleScan() {
    if (this.scan || this.store.dispatchBlocked()) return;
    this.scan = this.scheduler.tick(this.abort.signal).catch(e => { this.lastError = (e as Error).message; }).finally(() => { this.scan = undefined; });
  }
  private async recover(claim: Claim) {
    if (this.active.has(claim.attempt.id)) { this.active.get(claim.attempt.id)!.abort.abort(); return; }
    const file = join(this.home, 'attempts', claim.attempt.id, 'receipt.json');
    let saved: SavedResult | null = null;
    try { saved = await jsonFile<SavedResult>(file); } catch { /* A partial receipt is not completion. */ }
    if (saved?.attempt === claim.attempt.id && saved.generation === claim.attempt.generation && saved.digest === hash(saved.result)) {
      let valid = true;
      if (saved.result.artifact) {
        try { const f = await inside(this.home, saved.result.artifact.path); valid = sha256(await boundedRead(f)) === saved.result.artifact.sha256; } catch { valid = false; }
      }
      if (valid) {
        this.store.tx(() => {
          this.store.exec('UPDATE attempts SET owner=?,lease_until=? WHERE id=? AND status=?', this.owner, this.store.now() + this.store.config.limits.leaseMs, claim.attempt.id, 'running');
          claim.attempt.owner = this.owner;
          this.store.complete(claim, saved!.result);
          this.store.event('attempt.recovered', claim.attempt.id, { fromReceipt: true });
        });
        return;
      }
    }
    this.store.fail(claim, new StepError('transient', 'Attempt lease expired. Reconcile saved work and external operations before retry.'), true);
  }
  private async run(claim: Claim, abort: AbortController) {
    const beat = setInterval(() => {
      try {
        if (!this.store.heartbeat(claim.attempt.id, this.owner)) abort.abort();
      } catch { abort.abort(); }
    }, Math.max(50, this.store.config.limits.leaseMs / 4));
    const deadline = setTimeout(() => abort.abort(), this.store.config.limits.attemptMs + 5000);
    try {
      const result = await this.executor.run(claim, abort.signal);
      if (!this.store.current(claim.attempt.id, this.owner)) return;
      const receipt = { attempt: claim.attempt.id, generation: claim.attempt.generation, result, digest: hash(result) };
      await atomic(join(this.home, 'attempts', claim.attempt.id, 'receipt.json'), JSON.stringify(receipt));
      this.store.complete(claim, result);
    } catch (error) {
      if (error instanceof WaitError) {
        const first = this.store.one('SELECT min(started_at) AS at FROM attempts WHERE step_id=?', claim.step.id)!.at;
        if (this.store.now() - first > 86_400_000) this.store.fail(claim, new StepError('environment', `Wait deadline exceeded: ${error.message}`));
        else this.store.defer(claim, error.kind, error.message, error.delayMs);
      } else {
        const e = error instanceof StepError ? error : new StepError('environment', (error as Error).message);
        e.message = redact(e.message);
        if (this.shuttingDown && abort.signal.aborted) {
          this.store.defer(claim, 'restart', 'Controller stopped; resume from saved state', 0);
        } else this.store.fail(claim, e);
      }
    } finally { clearInterval(beat); clearTimeout(deadline); }
  }
  async stop() {
    this.shuttingDown = true; if (this.timer) clearInterval(this.timer);
    this.abort.abort();
    for (const { abort } of this.active.values()) abort.abort();
    await Promise.allSettled([...this.active.values()].map(x => x.promise));
    if (this.scan) await this.scan;
    this.store.releaseController(this.owner);
  }
  running() { return this.active.size; }
}
