import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Config, Claim, StepResult } from './types.ts';
import { StepError, WaitError } from './types.ts';
import { Store, hash } from './store.ts';
import { execute, type ProcessResult } from './process.ts';
import { atomic, inside, jsonFile, sha256 } from './files.ts';
import { selectChecks } from './checks.ts';
import { checkDigest } from './config.ts';
import { runAgent, validateProposals } from './agent.ts';

interface Candidate { workspace: string; head: string; base: string }
export class RepositoryWorkflow {
  home: string; config: Config; store: Store;
  constructor(home: string, config: Config, store: Store) { this.home = home; this.config = config; this.store = store; }
  async git(cwd: string, args: string[], signal?: AbortSignal, allowFailure = false): Promise<ProcessResult> {
    const result = await execute(['git', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, signal, timeoutMs: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (result.code && !allowFailure) throw new StepError('environment', `git ${args[0]} failed: ${result.stderr.slice(-1500)}`);
    return result;
  }
  async gh(args: string[], signal: AbortSignal, allowFailure = false) {
    const result = await execute(['gh', ...args, '-R', this.config.githubRepository!], { cwd: this.config.repository, signal, timeoutMs: 60_000 });
    if (result.code && !allowFailure) throw new StepError('transient', `GitHub ${args[0]} failed: ${result.stderr.slice(-1500)}`);
    return result;
  }
  async base(signal: AbortSignal) {
    if (this.config.integration === 'github') {
      const remote = (await this.git(this.config.repository, ['remote', 'get-url', 'origin'], signal)).stdout.trim();
      const ref = (await this.git(this.config.repository, ['ls-remote', '--exit-code', remote, `refs/heads/${this.config.baseBranch}`], signal)).stdout.trim().split(/\s+/)[0];
      return ref;
    }
    return (await this.git(this.config.repository, ['rev-parse', `refs/heads/${this.config.baseBranch}`], signal)).stdout.trim();
  }
  private async clone(source: string, target: string, ref: string, signal: AbortSignal) {
    await mkdir(resolve(target, '..'), { recursive: true });
    await this.git(this.home, ['clone', '--no-hardlinks', '--no-checkout', '--', source, target], signal);
    await this.git(target, ['checkout', '--detach', ref], signal);
    await this.git(target, ['remote', 'remove', 'origin'], signal);
    await this.git(target, ['config', 'user.name', 'Repository Automation'], signal);
    await this.git(target, ['config', 'user.email', 'loop@localhost'], signal);
    await this.git(target, ['config', 'commit.gpgsign', 'false'], signal);
  }
  private async fresh(claim: Claim, signal: AbortSignal, useCandidate = true): Promise<Candidate> {
    const dir = join(this.home, 'workspaces', claim.attempt.id);
    const context = JSON.parse(claim.run.context_json);
    const checkpoint = useCandidate ? await jsonFile<Candidate>(join(this.home, 'checkpoints', `${claim.run.id}.json`)) : null;
    const previous = useCandidate ? checkpoint || (context.workspace ? context as Candidate : null) : null;
    const base = await this.base(signal);
    if (previous) {
      await inside(this.home, previous.workspace);
      await this.clone(previous.workspace, dir, previous.head, signal);
    } else {
      await this.clone(this.config.repository, dir, 'HEAD', signal);
    }
    if (this.config.integration === 'github') {
      const remote = (await this.git(this.config.repository, ['remote', 'get-url', 'origin'], signal)).stdout.trim();
      await this.git(dir, ['fetch', '--no-tags', remote, `refs/heads/${this.config.baseBranch}`], signal);
    } else await this.git(dir, ['fetch', '--no-tags', this.config.repository, `refs/heads/${this.config.baseBranch}`], signal);
    if ((await this.git(dir, ['rev-parse', 'FETCH_HEAD'], signal)).stdout.trim() !== base) throw new StepError('revision', 'Base changed during checkout preparation');
    if (!previous) await this.git(dir, ['reset', '--hard', base], signal);
    else {
      const merge = await this.git(dir, ['merge', '--no-edit', base], signal, true);
      if (merge.code && !(await this.git(dir, ['diff', '--name-only', '--diff-filter=U'], signal)).stdout.trim()) throw new StepError('environment', 'Cannot update candidate from base');
    }
    return { workspace: dir, base, head: (await this.git(dir, ['rev-parse', 'HEAD'], signal)).stdout.trim() };
  }
  private async saveCandidate(claim: Claim, candidate: Candidate, signal: AbortSignal) {
    if (!this.store.current(claim.attempt.id, claim.attempt.owner)) return;
    const unresolved = (await this.git(candidate.workspace, ['diff', '--name-only', '--diff-filter=U'], signal)).stdout.trim();
    if (unresolved) throw new StepError('verification', `Unresolved merge conflicts: ${unresolved}`);
    await this.git(candidate.workspace, ['add', '--all'], signal);
    const changes = await this.git(candidate.workspace, ['diff', '--cached', '--quiet'], signal, true);
    const mergeHead = await this.git(candidate.workspace, ['rev-parse', '--verify', 'MERGE_HEAD'], signal, true);
    if (changes.code || mergeHead.code === 0) await this.git(candidate.workspace, ['commit', '-m', `feat: ${claim.work.title.replace(/[\r\n]/g, ' ').slice(0, 65)}`], signal);
    candidate.head = (await this.git(candidate.workspace, ['rev-parse', 'HEAD'], signal)).stdout.trim();
    await atomic(join(this.home, 'checkpoints', `${claim.run.id}.json`), JSON.stringify(candidate));
  }
  private async evidence(claim: Claim, kind: string, data: Record<string, unknown>): Promise<StepResult['artifact']> {
    const path = join('attempts', claim.attempt.id, `${kind}.json`), content = JSON.stringify(data, null, 2);
    await atomic(join(this.home, path), content);
    return { path, sha256: sha256(content), kind };
  }
  private async candidate(claim: Claim): Promise<Candidate & Record<string, any>> {
    const c = JSON.parse(claim.run.context_json);
    if (!c.workspace || !/^[0-9a-f]{40,64}$/.test(c.head || '') || !/^[0-9a-f]{40,64}$/.test(c.base || '')) throw new StepError('contract', 'Missing candidate identity');
    await inside(this.home, c.workspace); return c;
  }
  private queueContext(workId: string) {
    return this.store.all(`SELECT w.id,w.title,w.specification,r.status FROM work_items w JOIN runs r ON r.work_id=w.id WHERE w.id<>? AND r.revision=(SELECT max(revision) FROM runs WHERE work_id=w.id) ORDER BY (r.status IN ('active','waiting')) DESC,w.created_at DESC LIMIT 100`, workId)
      .map(w => ({ id: w.id, title: w.title, scope: w.specification.slice(0, 1500), status: w.status }));
  }
  async run(claim: Claim, signal: AbortSignal): Promise<StepResult> {
    const dir = join(this.home, 'attempts', claim.attempt.id);
    await mkdir(dir, { recursive: true });
    switch (claim.step.kind) {
      case 'implement': {
        const candidate = await this.fresh(claim, signal);
        let result;
        try { result = await runAgent(this.config, claim, candidate.workspace, dir, { checks: this.config.checks, base: candidate.base }, signal); }
        finally {
          // A missing model result must not discard useful edits. This checkpoint is not verification evidence.
          await this.saveCandidate(claim, candidate, signal.aborted ? AbortSignal.timeout(15000) : signal);
        }
        const context = { ...candidate, verification: null, review: null };
        if (result.outcome === 'needs_external') return { summary: result.summary, context, need: result.need };
        return { summary: result.summary, context, artifact: await this.evidence(claim, 'candidate', candidate as unknown as Record<string, unknown>) };
      }
      case 'verify': return this.verify(claim, signal);
      case 'review': {
        const candidate = await this.candidate(claim);
        await this.assertVerified(candidate);
        const workspace = join(this.home, 'workspaces', claim.attempt.id);
        await this.clone(candidate.workspace, workspace, candidate.head, signal);
        const diff = (await this.git(workspace, ['diff', '--no-ext-diff', candidate.base, candidate.head], signal)).stdout;
        if (diff.length > 500_000) throw new StepError('review', 'Patch exceeds the review input limit; split the work');
        const verification = await this.readEvidence(candidate.verification.artifact);
        const result = await runAgent(this.config, claim, workspace, dir, { diff, head: candidate.head, base: candidate.base, verification }, signal);
        await this.assertReadOnly(workspace, candidate.head, signal);
        if (result.outcome === 'needs_external') return { summary: result.summary, need: result.need };
        if (result.outcome === 'repair') return { summary: result.summary, repair: result.findings };
        if (result.outcome !== 'pass') throw new StepError('contract', 'Expected review result');
        const artifact = await this.evidence(claim, 'review', { ...result, head: candidate.head, base: candidate.base, checks: checkDigest(this.config) });
        return { summary: result.summary, artifact, context: { review: { head: candidate.head, base: candidate.base, artifact } }, advisories: result.advisories };
      }
      case 'publish': return this.publish(claim, signal);
      case 'integrate': return this.integrate(claim, signal);
      case 'observe': return this.observe(claim, signal);
      case 'plan': {
        const candidate = await this.fresh(claim, signal, false);
        const failures = claim.work.metadata?.failedRun ? this.store.all(`SELECT s.kind,a.failure_json FROM attempts a JOIN steps s ON s.id=a.step_id WHERE s.run_id=? AND a.failure_json IS NOT NULL ORDER BY a.started_at DESC LIMIT 8`, String(claim.work.metadata.failedRun)) : [];
        const result = await runAgent(this.config, claim, candidate.workspace, dir, { mode: 'Read the repository. Produce bounded work proposals. Return zero proposals when no justified work exists. Runtime or account defects must not be disguised as product changes.', failures, existingWork: this.queueContext(claim.work.id) }, signal);
        await this.assertReadOnly(candidate.workspace, candidate.head, signal);
        if (result.outcome === 'needs_external') return { summary: result.summary, need: result.need };
        if (result.outcome !== 'plan') throw new StepError('contract', 'Expected plan');
        return { summary: result.summary, context: { proposals: result.proposals, planBase: candidate.head }, artifact: await this.evidence(claim, 'plan', result as unknown as Record<string, unknown>) };
      }
      case 'check_plan': {
        const candidate = await this.fresh(claim, signal, false);
        const result = await runAgent(this.config, claim, candidate.workspace, dir, { proposals: JSON.parse(claim.run.context_json).proposals, existingWork: this.queueContext(claim.work.id), instruction: 'Check scope, evidence, duplicate work, and dependency order. Do not demand human approval for routine decomposition.' }, signal);
        await this.assertReadOnly(candidate.workspace, candidate.head, signal);
        if (result.outcome === 'needs_external') return { summary: result.summary, need: result.need };
        if (result.outcome === 'repair') return { summary: result.summary, repair: result.findings };
        return { summary: result.summary, artifact: await this.evidence(claim, 'plan-review', result as unknown as Record<string, unknown>) };
      }
      case 'apply_plan': {
        const proposals = validateProposals(JSON.parse(claim.run.context_json).proposals);
        return { summary: `Published ${proposals.length} verified work items to the durable queue`, proposals };
      }
      case 'resolve': {
        const candidate = await this.fresh(claim, signal, false);
        const result = await runAgent(this.config, claim, candidate.workspace, dir, { request: JSON.parse(claim.step.input_json), instruction: 'Independently check this external request. Apply a reversible standard default unless an essential external dependency prevents it.' }, signal);
        await this.assertReadOnly(candidate.workspace, candidate.head, signal);
        if (result.outcome === 'needs_external') return { summary: result.summary, need: result.need };
        if (result.outcome !== 'default') throw new StepError('contract', 'Expected decision result');
        return { summary: result.summary, defaultChoice: { choice: result.choice, refinement: result.refinement } };
      }
    }
  }
  private async assertReadOnly(workspace: string, head: string, signal: AbortSignal) {
    const actual = (await this.git(workspace, ['rev-parse', 'HEAD'], signal)).stdout.trim();
    const dirty = (await this.git(workspace, ['status', '--porcelain'], signal)).stdout.trim();
    if (actual !== head || dirty) throw new StepError('contract', 'Read-only worker changed the repository');
  }
  private async verify(claim: Claim, signal: AbortSignal): Promise<StepResult> {
    if (!this.config.checks.length) throw new StepError('environment', 'Configure at least one mandatory check before code work can pass');
    const candidate = await this.candidate(claim);
    const workspace = join(this.home, 'workspaces', claim.attempt.id);
    await this.clone(candidate.workspace, workspace, candidate.head, signal);
    const changed = (await this.git(workspace, ['diff', '--name-only', '-z', candidate.base, candidate.head], signal)).stdout.split('\0').filter(Boolean);
    let checks;
    try { checks = selectChecks(this.config.checks, changed); } catch(e) { throw new StepError('environment', (e as Error).message); }
    const records = [];
    for (const check of checks) {
      const i = this.config.checks.indexOf(check);
      const cwd = await inside(workspace, check.cwd);
      const log = join(this.home, 'attempts', claim.attempt.id, `check-${i}.log`);
      let result;
      try { result = await execute(check.command, { cwd, signal, timeoutMs: check.timeoutMs, maxBytes: this.config.limits.maxOutputBytes, log }); }
      catch (e) {
        if (signal.aborted) throw e;
        throw new StepError('environment', `Check ${check.name} could not complete: ${(e as Error).message}`, { log });
      }
      records.push({ name: check.name, command: check.command, cwd: check.cwd, exit: result.code, elapsedMs: result.elapsedMs, log: join('attempts', claim.attempt.id, `check-${i}.log`) });
      if (result.code !== 0) {
        await this.evidence(claim, 'verification', { ...candidate, status: 'failed', records });
        throw new StepError('verification', `Check ${check.name} exited ${result.code}. ${result.stdout.slice(-2000)} ${result.stderr.slice(-2000)}`, { log });
      }
    }
    if ((await this.git(workspace, ['rev-parse', 'HEAD'], signal)).stdout.trim() !== candidate.head || (await this.git(workspace, ['diff', 'HEAD', '--exit-code'], signal, true)).code !== 0) throw new StepError('verification', 'Checks changed the reviewed source');
    const artifact = await this.evidence(claim, 'verification', { head: candidate.head, base: candidate.base, status: 'passed', checks: checkDigest(this.config), records });
    return { summary: `${records.length} checks passed on ${candidate.head.slice(0, 12)}`, artifact, context: { verification: { head: candidate.head, base: candidate.base, checks: checkDigest(this.config), artifact } } };
  }
  private async readEvidence(artifact: { path: string; sha256: string }) {
    if (!artifact) throw new StepError('contract', 'Missing evidence reference');
    const file = await inside(this.home, artifact.path), content = await readFile(file, 'utf8');
    if (sha256(content) !== artifact.sha256) throw new StepError('contract', 'Evidence hash mismatch');
    return JSON.parse(content);
  }
  private async assertVerified(candidate: Record<string, any>, review = false) {
    const v = candidate.verification;
    if (!v || v.head !== candidate.head || v.base !== candidate.base || v.checks !== checkDigest(this.config)) throw new StepError('revision', 'Verification does not match the candidate or current checks');
    const data = await this.readEvidence(v.artifact);
    if (data.status !== 'passed' || data.head !== candidate.head || data.checks !== checkDigest(this.config) || !data.records?.length || data.records.some((x: any) => x.exit !== 0)) throw new StepError('contract', 'Invalid verification evidence');
    if (review) {
      const r = candidate.review;
      if (!r || r.head !== candidate.head || r.base !== candidate.base) throw new StepError('revision', 'Review does not match candidate');
      const proof = await this.readEvidence(r.artifact);
      if (proof.outcome !== 'pass' || proof.head !== candidate.head || proof.base !== candidate.base) throw new StepError('contract', 'Invalid review evidence');
    }
  }
  private async publish(claim: Claim, signal: AbortSignal): Promise<StepResult> {
    const c = await this.candidate(claim); await this.assertVerified(c, true);
    if (this.config.integration === 'local') return { summary: 'Candidate ready for local integration' };
    const branch = `z-loop/${claim.work.id}/r${claim.run.revision}`, key = `publish:${claim.run.id}:${c.head}`;
    this.store.operation(claim, key, 'publish', { branch, head: c.head });
    const remote = (await this.git(this.config.repository, ['remote', 'get-url', 'origin'], signal)).stdout.trim();
    const old = (await this.git(c.workspace, ['ls-remote', remote, `refs/heads/${branch}`], signal)).stdout.trim().split(/\s+/)[0] || '';
    if (old !== c.head) {
      if (old && !(await this.git(c.workspace, ['merge-base', '--is-ancestor', old, c.head], signal, true)).code) { /* Expected prior candidate. */ }
      else if (old) throw new StepError('revision', 'Remote work branch has unrelated changes');
      if (!this.store.current(claim.attempt.id, claim.attempt.owner)) throw new StepError('cancelled', 'Lease lost before push');
      await this.git(c.workspace, ['push', `--force-with-lease=refs/heads/${branch}:${old}`, remote, `${c.head}:refs/heads/${branch}`], signal);
    }
    const list = JSON.parse((await this.gh(['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state,url,headRefOid,baseRefName'], signal)).stdout);
    if (list.length > 1) throw new StepError('contract', 'More than one PR uses the work branch');
    let pr = list[0];
    if (pr?.state === 'CLOSED') throw new StepError('environment', 'Work PR was closed without merge');
    if (!pr) {
      const bodyFile = join(this.home, 'attempts', claim.attempt.id, 'pr-body.md');
      const issue = claim.work.metadata?.githubIssue;
      await atomic(bodyFile, `${claim.work.specification}\n\n${claim.work.acceptance.map(x => `- [x] ${x}`).join('\n')}\n\nLocal checks and independent review passed for ${c.head}.\nOperation: ${key}\n${Number.isSafeInteger(issue) ? `\nCloses #${issue}\n` : ''}`);
      await this.gh(['pr', 'create', '--head', branch, '--base', this.config.baseBranch, '--title', claim.work.title, '--body-file', bodyFile], signal);
      const found = JSON.parse((await this.gh(['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state,url,headRefOid,baseRefName'], signal)).stdout);
      if (found.length !== 1) throw new StepError('transient', 'PR publication not yet confirmed'); pr = found[0];
    }
    if (pr.headRefOid !== c.head || pr.baseRefName !== this.config.baseBranch) throw new StepError('revision', 'Published PR does not match candidate');
    this.store.confirmOperation(claim, key, pr);
    return { summary: `Published PR #${pr.number}`, context: { pr } };
  }
  private async integrate(claim: Claim, signal: AbortSignal): Promise<StepResult> {
    const c = await this.candidate(claim); await this.assertVerified(c, true);
    const key = `integrate:${claim.run.id}:${c.head}`;
    this.store.operation(claim, key, 'integrate', { head: c.head, base: c.base });
    if (this.config.integration === 'github') {
      if (!c.pr?.number) throw new StepError('contract', 'Missing PR');
      const pr = JSON.parse((await this.gh(['pr', 'view', String(c.pr.number), '--json', 'state,headRefOid,baseRefOid,baseRefName,mergeStateStatus,mergeCommit'], signal)).stdout);
      if (pr.headRefOid !== c.head) throw new StepError('revision', 'PR head changed after review');
      if (pr.state === 'MERGED') { this.store.confirmOperation(claim, key, pr); return { summary: 'Merge confirmed', context: { integrated: pr.mergeCommit?.oid || c.head } }; }
      if (pr.state !== 'OPEN') throw new StepError('environment', 'PR is no longer open');
      if (pr.baseRefOid !== c.base) throw new StepError('revision', 'Base changed; rebuild and review the updated candidate');
      const checks = await this.gh(['pr', 'checks', String(c.pr.number), '--required', '--json', 'name,bucket'], signal, true);
      if (checks.code !== 0 && checks.code !== 8) throw new WaitError('checks', 'Required check lookup failed');
      let rows; try { rows = JSON.parse(checks.stdout); } catch { throw new WaitError('checks', 'Required checks are unavailable'); }
      if (!Array.isArray(rows)) throw new WaitError('checks', 'Required checks are unavailable');
      if (rows.some(x => ['fail', 'cancel'].includes(x.bucket))) throw new StepError('verification', 'A required GitHub check failed');
      if (rows.some(x => !['pass', 'skipping'].includes(x.bucket))) throw new WaitError('checks', 'Required GitHub checks are pending');
      if (['BLOCKED', 'UNKNOWN', 'BEHIND', 'DIRTY'].includes(pr.mergeStateStatus)) throw new WaitError('merge_gate', `GitHub merge gate: ${pr.mergeStateStatus}`);
      if (!this.store.current(claim.attempt.id, claim.attempt.owner)) throw new StepError('cancelled', 'Lease lost before merge');
      const merged = await this.gh(['pr', 'merge', String(c.pr.number), '--merge', '--match-head-commit', c.head], signal, true);
      if (merged.code) throw new WaitError('merge_gate', 'GitHub refused merge; the controller will reconcile before another attempt');
      const after = JSON.parse((await this.gh(['pr', 'view', String(c.pr.number), '--json', 'state,headRefOid,mergeCommit'], signal)).stdout);
      if (after.state !== 'MERGED') throw new WaitError('merge_queue', 'PR is queued for merge');
      if (after.headRefOid !== c.head) throw new StepError('contract', 'Merged head differs from reviewed head');
      this.store.confirmOperation(claim, key, after);
      return { summary: 'GitHub merge confirmed', context: { integrated: after.mergeCommit?.oid || c.head } };
    }
    const repo = this.config.repository;
    await this.git(repo, ['fetch', '--no-tags', c.workspace, c.head], signal);
    const current = await this.base(signal);
    if ((await this.git(repo, ['merge-base', '--is-ancestor', c.head, current], signal, true)).code === 0) {
      this.store.confirmOperation(claim, key, { head: c.head, base: current }); return { summary: 'Candidate already integrated', context: { integrated: c.head } };
    }
    if (current !== c.base) throw new StepError('revision', 'Base changed; rebuild and review the updated candidate');
    const bare = (await this.git(repo, ['rev-parse', '--is-bare-repository'], signal)).stdout.trim() === 'true';
    if (!bare) {
      const branch = (await this.git(repo, ['symbolic-ref', '--short', 'HEAD'], signal)).stdout.trim();
      if (branch !== this.config.baseBranch || (await this.git(repo, ['status', '--porcelain'], signal)).stdout.trim()) throw new WaitError('repository', 'Local integration requires a clean checkout on the base branch');
    }
    if (!this.store.current(claim.attempt.id, claim.attempt.owner)) throw new StepError('cancelled', 'Lease lost before integration');
    if (bare) await this.git(repo, ['update-ref', `refs/heads/${this.config.baseBranch}`, c.head, c.base], signal);
    else await this.git(repo, ['merge', '--ff-only', c.head], signal);
    this.store.confirmOperation(claim, key, { head: c.head });
    return { summary: 'Candidate integrated into the local base', context: { integrated: c.head } };
  }
  private async observe(claim: Claim, signal: AbortSignal): Promise<StepResult> {
    const c = await this.candidate(claim);
    if (this.config.integration === 'github') {
      const pr = JSON.parse((await this.gh(['pr', 'view', String(c.pr?.number), '--json', 'state,headRefOid'], signal)).stdout);
      if (pr.state !== 'MERGED' || pr.headRefOid !== c.head) throw new StepError('contract', 'Final merge observation does not match reviewed work');
    } else {
      const base = await this.base(signal);
      if ((await this.git(this.config.repository, ['merge-base', '--is-ancestor', c.head, base], signal, true)).code) throw new StepError('contract', 'Integrated commit is absent from the base branch');
    }
    return { summary: 'Integration verified; work complete', artifact: await this.evidence(claim, 'completion', { head: c.head, integrated: c.integrated, observedAt: new Date().toISOString() }) };
  }
}
