import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { loadManagerConnection } from '../src/config.ts';

test('manager connection reads the endpoint port and token, with a default port fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'z-loop-manager-connection-'));
  try {
    assert.throws(() => loadManagerConnection(root), /No manager token/);

    await writeFile(join(root, 'token'), 'manager-token\n');
    assert.deepEqual(loadManagerConnection(root), { base: 'http://127.0.0.1:4188', token: 'manager-token' });

    const db = new DatabaseSync(join(root, 'manager.db'));
    db.exec('CREATE TABLE endpoint (id INTEGER PRIMARY KEY, port INTEGER)');
    db.prepare('INSERT INTO endpoint VALUES (1, 5000)').run();
    assert.deepEqual(loadManagerConnection(root), { base: 'http://127.0.0.1:5000', token: 'manager-token' });

    for (const port of [0, 65536, 70000]) {
      db.prepare('UPDATE endpoint SET port=? WHERE id=1').run(port);
      assert.equal(loadManagerConnection(root).base, 'http://127.0.0.1:4188', `port ${port} falls back`);
    }
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
