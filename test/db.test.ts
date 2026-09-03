import test from 'node:test';
import assert from 'node:assert/strict';
import { LoopDatabase } from '../src/db/index.ts';

test('LoopDatabase initializes in-memory and supports ticket CRUD', () => {
  const db = new LoopDatabase(':memory:');

  db.upsertTicket({
    id: 101,
    title: 'Implement billing checkout',
    state: 'ready',
    base_branch: 'main',
    branch_name: 'issue-101/billing-checkout',
    attempt: 1,
    repair_count: 0
  });

  const t = db.getTicket(101);
  assert.ok(t);
  assert.equal(t.title, 'Implement billing checkout');
  assert.equal(t.state, 'ready');

  // Update state to in-progress
  db.upsertTicket({
    ...t,
    state: 'in-progress',
    pr_number: 201,
    pr_url: 'https://github.com/org/repo/pull/201'
  });

  const updated = db.getTicket(101);
  assert.equal(updated?.state, 'in-progress');
  assert.equal(updated?.pr_number, 201);

  // Verdict recording
  db.saveVerdict({
    ticket_id: 101,
    session_id: '101-rev-r1',
    round: 1,
    head_oid: 'abc1234',
    verdict: 'PASS',
    task_status: 'works',
    bench_status: 'none',
    expected: 'All criteria pass',
    observed: 'All criteria pass',
    raw_markdown: 'VERDICT: PASS'
  });

  const verdicts = db.getVerdictsForTicket(101);
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].verdict, 'PASS');

  db.close();
});
