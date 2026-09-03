import { LoopDatabase } from './db/index.ts';
import type { TicketRow } from './db/index.ts';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseVerdict } from './engine/assurance.ts';

const rootDir = process.cwd();
const stateDir = join(rootDir, 'state');
const verdictsDir = join(rootDir, 'verdicts');
const decisionsDir = join(rootDir, 'decisions');
const dbPath = join(stateDir, 'loop.db');

const db = new LoopDatabase(dbPath);

console.log('=== Migrating Loop 1.0 State to Loop 2.0 SQLite Database ===');

// 1. Ingest Tickets from state/*.review.json
const files = readdirSync(stateDir);
const reviewFiles = files.filter((f) => f.endsWith('.review.json'));

let ticketCount = 0;
for (const file of reviewFiles) {
  const ticketId = parseInt(file.replace('.review.json', ''), 10);
  if (isNaN(ticketId)) continue;

  const content = JSON.parse(readFileSync(join(stateDir, file), 'utf8'));

  // Detect state from companion sentinel files
  let state: TicketRow['state'] = 'in-progress';
  if (existsSync(join(stateDir, `${ticketId}.merged`))) {
    state = 'merged';
  } else if (existsSync(join(stateDir, `${ticketId}.merged-audited`))) {
    state = 'merged-audited';
  } else if (existsSync(join(stateDir, `${ticketId}.manual-takeover`))) {
    state = 'manual-takeover';
  } else if (existsSync(join(stateDir, `${ticketId}.review`))) {
    state = 'review';
  } else if (existsSync(join(stateDir, `${ticketId}.parked`))) {
    state = 'parked';
  }

  const prNumber = content.pr ? parseInt(content.pr.replace(/^.*\/pull\//, ''), 10) : null;

  db.upsertTicket({
    id: ticketId,
    title: `Issue #${ticketId}`,
    state,
    pr_number: prNumber,
    pr_url: content.pr || null,
    base_branch: 'main',
    branch_name: `issue-${ticketId}`,
    base_oid: content.base_oid || null,
    head_oid: content.head_oid || null,
    attempt: 1,
    repair_count: content.blocking_repairs || 0
  });

  ticketCount++;
}

console.log(`Ingested ${ticketCount} tickets into loop.db.`);

// 2. Ingest Verdicts from verdicts/*.md
if (existsSync(verdictsDir)) {
  const verdictFiles = readdirSync(verdictsDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  let verdictCount = 0;
  for (const vf of verdictFiles) {
    const raw = readFileSync(join(verdictsDir, vf), 'utf8');
    const match = vf.match(/^(\d+)-/);
    if (!match) continue;
    const ticketId = parseInt(match[1], 10);

    // Ensure ticket exists in database for FK integrity
    if (!db.getTicket(ticketId)) {
      db.upsertTicket({
        id: ticketId,
        title: `Issue #${ticketId}`,
        state: 'merged',
        base_branch: 'main',
        branch_name: `issue-${ticketId}`,
        attempt: 1,
        repair_count: 0
      });
    }

    const parsed = parseVerdict(raw);

    db.saveVerdict({
      ticket_id: ticketId,
      session_id: vf.replace(/\.md$/, ''),
      round: parsed.round,
      head_oid: '',
      verdict: parsed.verdict,
      task_status: parsed.task,
      bench_status: parsed.bench,
      expected: parsed.expected,
      observed: parsed.observed,
      blockers_json: JSON.stringify(parsed.blockers),
      advisories_json: JSON.stringify(parsed.advisories),
      raw_markdown: raw
    });
    verdictCount++;
  }
  console.log(`Ingested ${verdictCount} verdicts into loop.db.`);
}

// 3. Ingest Decision Cards from decisions/*.card.md
if (existsSync(decisionsDir)) {
  const cardFiles = readdirSync(decisionsDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  let cardCount = 0;
  for (const cf of cardFiles) {
    const raw = readFileSync(join(decisionsDir, cf), 'utf8');
    const slug = cf.replace(/\.md$/, '');
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : slug;

    db.upsertDecisionCard({
      slug,
      title,
      domain: 'implement',
      status: raw.includes('## Decision') ? 'answered' : 'open',
      question: title,
      context: raw,
      options_json: '[]'
    });
    cardCount++;
  }
  console.log(`Ingested ${cardCount} decision cards into loop.db.`);
}

console.log('=== Migration Complete! ===');
db.close();
