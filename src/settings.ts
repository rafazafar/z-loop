import type { Store } from './store.ts';
import { validateConfig } from './config.ts';
import type { Config } from './types.ts';

export function configuration(store: Store) {
  return {
    config: store.config,
    revision: Number(store.one("SELECT value FROM settings WHERE key='config_revision'")?.value || 1),
    pending: JSON.parse(store.one("SELECT value FROM settings WHERE key='pending_config'")?.value || 'null') as Config | null
  };
}
export function saveConfiguration(store: Store, value: unknown, revision: number) {
  const next = validateConfig(structuredClone(value));
  return store.tx(() => {
    const current = configuration(store);
    if (revision !== current.revision || current.pending) throw new Error('Configuration changed. Reload settings before saving.');
    if (next.repository !== store.config.repository || JSON.stringify(next.server) !== JSON.stringify(store.config.server)) throw new Error('Repository and server address are fixed for this state directory. Initialize a new directory to change them.');
    if ((next.baseBranch !== store.config.baseBranch || next.integration !== store.config.integration || next.githubRepository !== store.config.githubRepository) && store.one("SELECT 1 FROM runs WHERE status IN ('active','waiting')")) throw new Error('Finish or cancel open runs before changing integration settings.');
    store.exec("INSERT OR REPLACE INTO settings VALUES('pending_config',?)", JSON.stringify(next));
    store.event('configuration.queued', 'configuration', { revision: current.revision + 1 });
    return { queued: true, revision: current.revision + 1 };
  });
}
export function applyConfiguration(store: Store) {
  const next = store.tx(() => {
    const current = configuration(store);
    if (store.one("SELECT 1 FROM settings WHERE key='maintenance_until' AND CAST(value AS INTEGER)>?", store.now())) return null;
    if (!current.pending || store.one("SELECT 1 FROM attempts WHERE status='running'")) return null;
    store.exec("INSERT OR REPLACE INTO settings VALUES('runtime_config',?)", JSON.stringify(current.pending));
    store.exec("INSERT OR REPLACE INTO settings VALUES('config_revision',?)", String(current.revision + 1));
    store.exec("DELETE FROM settings WHERE key='pending_config'");
    store.event('configuration.applied', 'configuration', { revision: current.revision + 1 });
    return current.pending;
  });
  if (next) {
    for (const key of Object.keys(store.config)) delete (store.config as any)[key];
    Object.assign(store.config, next);
  }
  return !!next;
}
