import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/process.ts';
import { defaults } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { Controller } from '../src/controller.ts';
import { RepositoryWorkflow } from '../src/repository.ts';

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'z-loop-test-')), repo = join(root, 'repo'), home = join(root, 'state');
  await mkdir(repo); await mkdir(home);
  const git = async (...args: string[]) => { const r = await execute(['git', ...args], { cwd: repo }); if (r.code) throw new Error(r.stderr); return r.stdout.trim(); };
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@localhost'); await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(repo, 'answer.mjs'), 'export const answer = 0;\n');
  await writeFile(join(repo, 'check.mjs'), "import {answer} from './answer.mjs'; import assert from 'node:assert/strict'; assert.equal(answer,42); console.log('checked answer 42');\n");
  await git('add', '.'); await git('commit', '-qm', 'test: initial fixture');
  const config = defaults(repo);
  config.worker = { kind: 'command', command: [process.execPath, fileURLToPath(new URL('../examples/fixture-worker.mjs', import.meta.url))] };
  config.checks = [{ name: 'answer', command: [process.execPath, 'check.mjs'], cwd: '.', timeoutMs: 5000 }];
  config.limits.retryBaseMs = 10; config.limits.leaseMs = 1000; config.limits.attemptMs = 15_000; config.server.port = 0;
  const store = new Store(join(home, 'state.db'), config);
  const controller = new Controller(store, home, new RepositoryWorkflow(home, config, store));
  return { root, repo, home, config, store, controller, git, async close() { await controller.stop(); store.close(); await rm(root, { recursive: true, force: true }); } };
}
export const work = (extra: Record<string, any> = {}) => ({ title: 'Return the expected answer', specification: 'Set the exported answer to 42.', acceptance: ['The exported answer is 42 and the check passes.'], ...extra });
export async function until(fn: () => boolean | Promise<boolean>, timeout = 20_000) {
  const start = Date.now();
  while (!(await fn())) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition'); await new Promise(r => setTimeout(r, 25)); }
}
