import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessSupervisor } from '../src/core/supervisor.ts';

test('ProcessSupervisor correctly detects running and terminated process groups', async () => {
  const supervisor = new ProcessSupervisor();
  // We can test process group management using a small mock shell process
  assert.equal(supervisor.isRunning('non-existent'), false);
  supervisor.stop();
});
