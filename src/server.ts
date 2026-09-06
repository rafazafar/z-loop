import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { configuration } from './settings.ts';
import { backupState } from './backup.ts';
import { readFile, readdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { Store } from './store.ts';
import type { Controller } from './controller.ts';
import { command } from './commands.ts';
import { inside, boundedRead, redact } from './files.ts';

export async function serve(store: Store, controller: Controller, home: string, token: string, port = store.config.server.port): Promise<Server> {
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if (url.pathname === '/health' && req.method === 'GET') {
        const healthy = store.isOwner(controller.owner) && !controller.lastError;
        send(healthy ? 200 : 503, { healthy, running: controller.running() }); return;
      }
      const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/forms.js': ['forms.js', 'text/javascript'] };
      if (files[url.pathname] && req.method === 'GET') {
        const [file, type] = files[url.pathname];
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(await readFile(new URL(`../web/${file}`, import.meta.url))); return;
      }
      const supplied = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { send(401, { error: 'Authentication required. Run z-loop console or enter the local access token.' }); return; }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { send(403, { error: 'Cross-origin commands are disabled' }); return; }
      if (url.pathname === '/api/state' && req.method === 'GET') { send(200, { ...store.snapshot(), configuration: configuration(store), runtime: { error: controller.lastError, version: '0.1.0', commandReceipts: true, history: true, backupReceipts: true } }); return; }
      if (url.pathname === '/api/events' && req.method === 'GET') { send(200, store.eventHistory(url.searchParams.get('search') || '', Number(url.searchParams.get('offset') || 0))); return; }
      if (url.pathname === '/api/history' && req.method === 'GET') { send(200, store.history(url.searchParams.get('search') || '', url.searchParams.get('status') || 'all', Number(url.searchParams.get('offset') || 0))); return; }
      if (url.pathname === '/api/work' && req.method === 'GET') { send(200, store.detail(url.searchParams.get('id') || '')); return; }
      if (url.pathname === '/api/system' && req.method === 'GET') {
        const disk = await statfs(home);
        const backups = (await readdir(join(home, 'backups')).catch(() => [])).filter(x => x.startsWith('backup-')).sort().reverse();
        send(200, { database: 'SQLite WAL / synchronous FULL', freeBytes: disk.bavail * disk.bsize,
          checks: store.config.checks.length, repository: store.config.repository, backups,
          maintenance: !!store.one("SELECT 1 FROM settings WHERE key='maintenance_until' AND CAST(value AS INTEGER)>?", store.now()),
          running: controller.running(), configuration: configuration(store),
          counts: { work: store.one('SELECT count(*) AS n FROM work_items')!.n, attempts: store.one('SELECT count(*) AS n FROM attempts')!.n, events: store.one('SELECT count(*) AS n FROM events')!.n } }); return;
      }
      if (url.pathname === '/api/evidence' && req.method === 'GET') {
        const name = url.searchParams.get('path') || '';
        if (!/^attempts\/[a-f0-9-]{36}\/(?:worker\.log|check-\d+\.log|[a-z-]+\.json)$/.test(name)) { send(400, { error: 'Invalid evidence path' }); return; }
        const file = await inside(home, name);
        send(200, { path: name, text: redact(await boundedRead(file, store.config.limits.maxOutputBytes)) }); return;
      }
      if (url.pathname === '/api/command' && req.method === 'POST') {
        let body = '', size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 200_000) { send(413, { error: 'Command too large' }); req.resume(); return; } body += chunk.toString(); }
        const input = JSON.parse(body);
        if (input.type === 'system.integrity') { send(200, { results: store.all('PRAGMA integrity_check') }); return; }
        if (input.type === 'system.backup') { send(200, { path: await backupState(store, home, input.operationKey) }); return; }
        const result = command(store, input); send(200, result); return;
      }
      send(404, { error: 'Not found' });
    } catch (e) { send(400, { error: redact((e as Error).message) }); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(port, store.config.server.host, () => { server.off('error', fail); done(); }); });
  return server;
}
