import test from 'node:test';
import assert from 'node:assert/strict';
import { transition } from '../src/core/state-machine.ts';

test('state-machine correctly transitions through the standard maker-checker lifecycle', () => {
  let s = transition('ready', { type: 'SPAWN_WORKER' });
  assert.equal(s, 'in-progress');

  s = transition(s, { type: 'PR_OPENED' });
  assert.equal(s, 'review');

  s = transition(s, { type: 'VERDICT_BLOCK' });
  assert.equal(s, 'fix');

  s = transition(s, { type: 'PR_OPENED' });
  assert.equal(s, 'review');

  s = transition(s, { type: 'VERDICT_PASS' });
  assert.equal(s, 'done');

  s = transition(s, { type: 'PR_MERGED_ASSURED' });
  assert.equal(s, 'merged');
});

test('state-machine rejects illegal transitions', () => {
  assert.throws(() => {
    transition('done', { type: 'SPAWN_WORKER' });
  }, /Invalid state transition/);
});
