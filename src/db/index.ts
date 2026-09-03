import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TicketRow {
  id: number;
  title: string;
  state: 'ready' | 'in-progress' | 'review' | 'fix' | 'done' | 'parked' | 'merged' | 'merged-unverified' | 'merged-audited' | 'manual-takeover';
  pr_number?: number | null;
  pr_url?: string | null;
  base_branch: string;
  branch_name: string;
  base_oid?: string | null;
  head_oid?: string | null;
  attempt: number;
  repair_count: number;
  parked_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SessionRow {
  id: string;
  ticket_id?: number | null;
  role: string;
  phase: string;
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
  model: string;
  variant: string;
  worktree_path?: string | null;
  pgid?: number | null;
  exit_code?: number | null;
  started_at: string;
  ended_at?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  result_text?: string | null;
}

export interface VerdictRow {
  id?: number;
  ticket_id: number;
  session_id: string;
  round: number;
  head_oid: string;
  verdict: 'PASS' | 'BLOCK';
  task_status: string;
  bench_status: string;
  expected?: string | null;
  observed?: string | null;
  blockers_json?: string;
  advisories_json?: string;
  raw_markdown: string;
  created_at?: string;
}

export interface DecisionCardRow {
  slug: string;
  title: string;
  domain: string;
  status: 'open' | 'answered' | 'dismissed';
  ticket_id?: number | null;
  question: string;
  context: string;
  options_json: string;
  recommendation?: string | null;
  selected_option?: string | null;
  owner_note?: string | null;
  answered_at?: string | null;
  created_at?: string;
}

export class LoopDatabase {
  public db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    this.db.exec(schemaSql);
  }

  // --- Tickets ---
  public getTicket(id: number): TicketRow | null {
    const stmt = this.db.prepare('SELECT * FROM tickets WHERE id = ?');
    return (stmt.get(id) as TicketRow) || null;
  }

  public listTickets(stateFilter?: string): TicketRow[] {
    if (stateFilter) {
      const stmt = this.db.prepare('SELECT * FROM tickets WHERE state = ? ORDER BY id ASC');
      return stmt.all(stateFilter) as TicketRow[];
    }
    const stmt = this.db.prepare('SELECT * FROM tickets ORDER BY id ASC');
    return stmt.all() as TicketRow[];
  }

  public upsertTicket(ticket: TicketRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO tickets (
        id, title, state, pr_number, pr_url, base_branch, branch_name,
        base_oid, head_oid, attempt, repair_count, parked_reason, updated_at
      ) VALUES (
        $id, $title, $state, $pr_number, $pr_url, $base_branch, $branch_name,
        $base_oid, $head_oid, $attempt, $repair_count, $parked_reason, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        state = excluded.state,
        pr_number = excluded.pr_number,
        pr_url = excluded.pr_url,
        base_branch = excluded.base_branch,
        branch_name = excluded.branch_name,
        base_oid = excluded.base_oid,
        head_oid = excluded.head_oid,
        attempt = excluded.attempt,
        repair_count = excluded.repair_count,
        parked_reason = excluded.parked_reason,
        updated_at = datetime('now')
    `);

    stmt.run({
      $id: ticket.id,
      $title: ticket.title,
      $state: ticket.state,
      $pr_number: ticket.pr_number ?? null,
      $pr_url: ticket.pr_url ?? null,
      $base_branch: ticket.base_branch,
      $branch_name: ticket.branch_name,
      $base_oid: ticket.base_oid ?? null,
      $head_oid: ticket.head_oid ?? null,
      $attempt: ticket.attempt,
      $repair_count: ticket.repair_count,
      $parked_reason: ticket.parked_reason ?? null
    });
  }

  // --- Sessions ---
  public getSession(id: string): SessionRow | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return (stmt.get(id) as SessionRow) || null;
  }

  public listSessions(ticketId?: number): SessionRow[] {
    if (ticketId) {
      const stmt = this.db.prepare('SELECT * FROM sessions WHERE ticket_id = ? ORDER BY started_at DESC');
      return stmt.all(ticketId) as SessionRow[];
    }
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC');
    return stmt.all() as SessionRow[];
  }

  public upsertSession(session: SessionRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, ticket_id, role, phase, status, model, variant,
        worktree_path, pgid, exit_code, started_at, ended_at,
        duration_ms, error_message, result_text
      ) VALUES (
        $id, $ticket_id, $role, $phase, $status, $model, $variant,
        $worktree_path, $pgid, $exit_code, $started_at, $ended_at,
        $duration_ms, $error_message, $result_text
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        pgid = excluded.pgid,
        exit_code = excluded.exit_code,
        ended_at = excluded.ended_at,
        duration_ms = excluded.duration_ms,
        error_message = excluded.error_message,
        result_text = excluded.result_text
    `);

    stmt.run({
      $id: session.id,
      $ticket_id: session.ticket_id ?? null,
      $role: session.role,
      $phase: session.phase,
      $status: session.status,
      $model: session.model,
      $variant: session.variant,
      $worktree_path: session.worktree_path ?? null,
      $pgid: session.pgid ?? null,
      $exit_code: session.exit_code ?? null,
      $started_at: session.started_at,
      $ended_at: session.ended_at ?? null,
      $duration_ms: session.duration_ms ?? null,
      $error_message: session.error_message ?? null,
      $result_text: session.result_text ?? null
    });
  }

  // --- Verdicts ---
  public saveVerdict(v: VerdictRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO verdicts (
        ticket_id, session_id, round, head_oid, verdict, task_status,
        bench_status, expected, observed, blockers_json, advisories_json, raw_markdown
      ) VALUES (
        $ticket_id, $session_id, $round, $head_oid, $verdict, $task_status,
        $bench_status, $expected, $observed, $blockers_json, $advisories_json, $raw_markdown
      )
    `);

    stmt.run({
      $ticket_id: v.ticket_id,
      $session_id: v.session_id,
      $round: v.round,
      $head_oid: v.head_oid,
      $verdict: v.verdict,
      $task_status: v.task_status,
      $bench_status: v.bench_status,
      $expected: v.expected ?? null,
      $observed: v.observed ?? null,
      $blockers_json: v.blockers_json || '[]',
      $advisories_json: v.advisories_json || '[]',
      $raw_markdown: v.raw_markdown
    });
  }

  public getVerdictsForTicket(ticketId: number): VerdictRow[] {
    const stmt = this.db.prepare('SELECT * FROM verdicts WHERE ticket_id = ? ORDER BY round ASC, id ASC');
    return stmt.all(ticketId) as VerdictRow[];
  }

  // --- Decision Cards ---
  public upsertDecisionCard(card: DecisionCardRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO decision_cards (
        slug, title, domain, status, ticket_id, question, context,
        options_json, recommendation, selected_option, owner_note, answered_at
      ) VALUES (
        $slug, $title, $domain, $status, $ticket_id, $question, $context,
        $options_json, $recommendation, $selected_option, $owner_note, $answered_at
      )
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        selected_option = excluded.selected_option,
        owner_note = excluded.owner_note,
        answered_at = excluded.answered_at
    `);

    stmt.run({
      $slug: card.slug,
      $title: card.title,
      $domain: card.domain,
      $status: card.status,
      $ticket_id: card.ticket_id ?? null,
      $question: card.question,
      $context: card.context,
      $options_json: card.options_json,
      $recommendation: card.recommendation ?? null,
      $selected_option: card.selected_option ?? null,
      $owner_note: card.owner_note ?? null,
      $answered_at: card.answered_at ?? null
    });
  }

  public listDecisionCards(statusFilter?: string): DecisionCardRow[] {
    if (statusFilter) {
      const stmt = this.db.prepare('SELECT * FROM decision_cards WHERE status = ? ORDER BY created_at DESC');
      return stmt.all(statusFilter) as DecisionCardRow[];
    }
    const stmt = this.db.prepare('SELECT * FROM decision_cards ORDER BY created_at DESC');
    return stmt.all() as DecisionCardRow[];
  }

  // --- Audit Logging ---
  public logAudit(eventType: string, entityId?: string, payload: Record<string, any> = {}): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (event_type, entity_id, payload_json)
      VALUES (?, ?, ?)
    `);
    stmt.run(eventType, entityId || null, JSON.stringify(payload));
  }

  public close(): void {
    this.db.close();
  }
}
