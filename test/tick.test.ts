import test from 'node:test';
import assert from 'node:assert/strict';
import { LoopDatabase } from '../src/db/index.ts';
import { loadConfig } from '../src/config.ts';
import { GithubClient } from '../src/core/github.ts';
import { ProcessSupervisor } from '../src/core/supervisor.ts';
import { runTick } from '../src/engine/tick.ts';

test('runTick runs a deterministic reconciliation pass', async () => {
  const db = new LoopDatabase(':memory:');
  const { config } = loadConfig();
  const github = new GithubClient('org/test');
  const supervisor = new ProcessSupervisor();

  const summary = await runTick(db, config, github, supervisor, process.cwd());
  assert.equal(summary.activeCount, 0);
  assert.equal(typeof summary.reconciledPrs, 'number');

  supervisor.stop();
  db.close();
});
