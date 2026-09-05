import { DatabaseSync } from 'node:sqlite';
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Store, uid } from './store.ts';
import { atomic } from './files.ts';

export async function backupState(store: Store, home: string): Promise<string> {
  store.tx(() => {
  if (store.one("SELECT count(*) AS n FROM attempts WHERE status='running'")!.n) throw new Error('Backup requires drained workers. Pause dispatch and wait for active attempts to finish.');
  if (store.one("SELECT value FROM settings WHERE key='paused'")?.value !== 'true') throw new Error('Pause dispatch before backup');
    if (store.one("SELECT 1 FROM settings WHERE key='maintenance_until' AND CAST(value AS INTEGER)>?", store.now())) throw new Error('A backup is already in progress');
    store.exec("INSERT OR REPLACE INTO settings VALUES('maintenance_until',?)", String(store.now() + 60000));
  });
  const renew = setInterval(() => store.exec("UPDATE settings SET value=? WHERE key='maintenance_until'", String(store.now()+60000)), 10000);
  const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${uid().slice(0, 8)}`;
  const temp = join(home, 'backups', `.${name}`), target = join(home, 'backups', name);
  try {
    await mkdir(temp, { recursive: true, mode: 0o700 });
    await store.backup(join(temp, 'state.db'));
    const copy = new DatabaseSync(join(temp, 'state.db'));
    try { copy.exec("DELETE FROM controller; DELETE FROM settings WHERE key='maintenance_until';"); } finally { copy.close(); }
    for (const dir of ['attempts', 'workspaces', 'checkpoints']) {
      try { await cp(join(home, dir), join(temp, dir), { recursive: true, dereference: false }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    await atomic(join(temp, 'config.json'), JSON.stringify(store.config, null, 2));
    await atomic(join(temp, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), originalHome: home, restoreToSamePath: true, includesCredentials: false }));
    await rename(temp, target);
    store.event('backup.created', name); return target;
  } catch (e) { await rm(temp, { recursive: true, force: true }); throw e; }
  finally { clearInterval(renew); store.exec("DELETE FROM settings WHERE key='maintenance_until'"); }
}
