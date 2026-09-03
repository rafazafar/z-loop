import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict, isBlockingVerdict } from '../src/engine/assurance.ts';

test('parseVerdict correctly identifies PASS with advisories as non-blocking', () => {
  const md = `
VERDICT: PASS
TASK: works
BENCH: none
ROUND: 2
blockers:
- none
advisories:
- P2 · code · test.dart · Minor naming issue
`;
  const parsed = parseVerdict(md);
  assert.equal(parsed.verdict, 'PASS');
  assert.equal(parsed.task, 'works');
  assert.equal(parsed.blockers.length, 0);
  assert.equal(parsed.advisories.length, 1);
  assert.equal(isBlockingVerdict(parsed), false);
});

test('parseVerdict correctly identifies P1 blocker as blocking', () => {
  const md = `
VERDICT: BLOCK
TASK: broken
BENCH: none
ROUND: 1
blockers:
- P1 · safety · auth.dart · Stale credential leak
advisories:
- none
`;
  const parsed = parseVerdict(md);
  assert.equal(parsed.verdict, 'BLOCK');
  assert.equal(parsed.blockers.length, 1);
  assert.equal(isBlockingVerdict(parsed), true);
});
