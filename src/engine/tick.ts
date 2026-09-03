import { LoopDatabase } from '../db/index.ts';
import type { TicketRow, SessionRow } from '../db/index.ts';
import type { LoopConfig } from '../config.ts';
import { GithubClient } from '../core/github.ts';
import { ProcessSupervisor } from '../core/supervisor.ts';
import { checkCircuitBreaker } from './circuit-breaker.ts';
import { transition } from '../core/state-machine.ts';
import { parseVerdict, isBlockingVerdict } from './assurance.ts';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface TickSummary {
  reconciledPrs: number;
  completedSessions: number;
  dispatchedSessions: number;
  activeCount: number;
  warnings: string[];
}

export async function runTick(
  db: LoopDatabase,
  config: LoopConfig,
  github: GithubClient,
  supervisor: ProcessSupervisor,
  rootDir: string
): Promise<TickSummary> {
  const summary: TickSummary = {
    reconciledPrs: 0,
    completedSessions: 0,
    dispatchedSessions: 0,
    activeCount: 0,
    warnings: []
  };

  // 1. Circuit breaker check
  const cb = checkCircuitBreaker(db);
  if (cb.status === 'tripped') {
    summary.warnings.push(`Circuit breaker tripped on model ${cb.model} until ${cb.cooldownUntil}: ${cb.reason}`);
    return summary;
  }

  // 2. Reconcile active tickets against GitHub PRs
  const activeTickets = db.listTickets().filter((t) =>
    ['in-progress', 'review', 'fix', 'done'].includes(t.state) && t.pr_number
  );

  for (const t of activeTickets) {
    if (!t.pr_number) continue;
    const pr = await github.getPr(t.pr_number);
    if (!pr) continue;

    if (pr.state === 'MERGED') {
      if (t.state === 'done') {
        t.state = transition(t.state, { type: 'PR_MERGED_ASSURED' });
        t.head_oid = pr.headRefOid;
        db.upsertTicket(t);
        db.logAudit('TICKET_MERGED_ASSURED', String(t.id), { pr: pr.number });
        summary.reconciledPrs++;
      } else {
        t.state = transition(t.state, { type: 'PR_MERGED_BYPASS' });
        t.head_oid = pr.headRefOid;
        db.upsertTicket(t);
        db.logAudit('TICKET_MERGED_UNVERIFIED', String(t.id), { pr: pr.number });
        summary.reconciledPrs++;
      }
    }
  }

  // 3. Collect completed sessions
  const runningSessions = db.listSessions().filter((s) => s.status === 'running');
  for (const s of runningSessions) {
    const isLive = supervisor.isRunning(s.id);
    if (!isLive) {
      // Process has finished
      const resultPath = join(rootDir, 'state', 'sessions', `${s.id}.result`);
      let resultText = '';
      if (existsSync(resultPath)) {
        resultText = readFileSync(resultPath, 'utf8');
      }

      s.status = 'completed';
      s.result_text = resultText;
      s.ended_at = new Date().toISOString();
      db.upsertSession(s);
      summary.completedSessions++;

      // Advance ticket state
      if (s.ticket_id) {
        const ticket = db.getTicket(s.ticket_id);
        if (ticket) {
          if (s.phase === 'build' || s.phase === 'repair') {
            // Find PR URL from resultText if present
            const prMatch = resultText.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/);
            if (prMatch) {
              ticket.pr_number = parseInt(prMatch[1], 10);
              ticket.pr_url = prMatch[0];
            }
            ticket.state = transition(ticket.state, { type: 'PR_OPENED' });
            db.upsertTicket(ticket);
            db.logAudit('WORKER_PR_OPENED', String(ticket.id), { pr: ticket.pr_url });
          } else if (s.phase === 'review') {
            const verdictPath = join(rootDir, 'verdicts', `${s.id}.verdict.md`);
            if (existsSync(verdictPath)) {
              const verdictMd = readFileSync(verdictPath, 'utf8');
              const parsed = parseVerdict(verdictMd);
              db.saveVerdict({
                ticket_id: ticket.id,
                session_id: s.id,
                round: parsed.round,
                head_oid: ticket.head_oid || '',
                verdict: parsed.verdict,
                task_status: parsed.task,
                bench_status: parsed.bench,
                expected: parsed.expected,
                observed: parsed.observed,
                blockers_json: JSON.stringify(parsed.blockers),
                advisories_json: JSON.stringify(parsed.advisories),
                raw_markdown: verdictMd
              });

              if (isBlockingVerdict(parsed)) {
                ticket.state = transition(ticket.state, { type: 'VERDICT_BLOCK' });
                ticket.repair_count++;
                db.upsertTicket(ticket);
                db.logAudit('VERDICT_BLOCK', String(ticket.id), { blockers: parsed.blockers });
              } else {
                ticket.state = transition(ticket.state, { type: 'VERDICT_PASS' });
                db.upsertTicket(ticket);
                db.logAudit('VERDICT_PASS', String(ticket.id));
              }
            }
          }
        }
      }
    }
  }

  summary.activeCount = db.listSessions().filter((s) => s.status === 'running').length;
  return summary;
}
