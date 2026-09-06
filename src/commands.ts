import { saveConfiguration } from './settings.ts';
import { Store } from './store.ts';
import { defineAutomation, deleteAutomation } from './automations.ts';

export function command(store: Store, input: any): unknown {
  if (!input || typeof input.type !== 'string') throw new Error('Command type is required');
  if (store.one("SELECT 1 FROM settings WHERE key='maintenance_until' AND CAST(value AS INTEGER)>?", store.now())) throw new Error('Backup is in progress. Try again after it finishes.');
  switch (input.type) {
    case 'configuration.save': return saveConfiguration(store, input.config, input.revision);
    case 'configuration.cancel': store.tx(() => { store.exec("DELETE FROM settings WHERE key='pending_config'"); store.event('configuration.cancelled', 'configuration'); }); return { cancelled: true };
    case 'automation.scan': {
      const changed = store.exec('UPDATE automations SET next_at=? WHERE id=? AND enabled=1', store.now(), input.id);
      if (!changed.changes) throw new Error('Enable this automation before scanning.');
      store.event('automation.scan_requested', input.id); return { scheduled: true };
    }
    case 'work.create': return store.createWork(input.work);
    case 'work.rerun': return { runId: store.rerun(input.workId) };
    case 'run.cancel': store.cancel(input.runId); return { cancelled: true };
    case 'controller.pause': store.setPaused(true); return { paused: true };
    case 'controller.resume': store.setPaused(false); return { paused: false };
    case 'decision.answer': store.answer(input.id, input.answer); return { answered: true };
    case 'automation.save': return { id: defineAutomation(store, input.automation) };
    case 'automation.delete': return { deleted: deleteAutomation(store, input.id) };
    case 'automation.enable': {
      if (typeof input.enabled !== 'boolean') throw new Error('enabled must be boolean');
      return store.tx(() => {
        const changed = store.exec('UPDATE automations SET enabled=?,updated_at=? WHERE id=?', Number(input.enabled), store.now(), input.id);
        if (!changed.changes) throw new Error('Unknown automation');
        store.event('automation.enabled', input.id, { enabled: input.enabled }); return { enabled: input.enabled };
      });
    }
    default: throw new Error('Unknown command');
  }
}
