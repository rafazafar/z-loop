#!/usr/bin/env node
import { resolve, join, dirname } from 'node:path';
import { mkdir, readFile, access, chmod } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { defaults, loadConfig, loadConnection, loadManagerConnection, validateConfig } from './config.ts';
import { Store } from './store.ts';
import { Controller } from './controller.ts';
import { RepositoryWorkflow } from './repository.ts';
import { serve } from './server.ts';
import { atomic } from './files.ts';
import { execute } from './process.ts';
import { backupState } from './backup.ts';
import { discoverChecks } from './initialize.ts';
import { Manager } from './manager.ts';
import { serveManager } from './manager-server.ts';
import { needsSetup, startOnboarding } from './onboarding.ts';

const args = process.argv.slice(2);
function option(name: string): string | undefined { const i = args.indexOf(name); if (i < 0) return; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`); return args[i + 1]; }
const home = resolve(option('--home') || process.env.Z_LOOP_HOME || '.loop');
const action = args[0] || 'help';
const print = (x: unknown) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
async function readJson(file: string | undefined) { if (!file) throw new Error('Use --file with a JSON file'); return JSON.parse(await readFile(resolve(file), 'utf8')); }
async function main() {
  if (action === 'help' || args.includes('--help')) {
    print(`z-loop — durable repository automation\n\nmanage [--home PATH] [--port PORT] [--no-open]\ninit --repo PATH [--config JSON] [--home PATH]\nserve [--home PATH] [--port PORT] [--no-open]\nconsole [--manager]\nadd --file work.json\nautomation --file automation.json\ncommand --file command.json\npause | resume\ncancel --run ID\nretry --work ID\nanswer --decision ID --text TEXT\nbackup\n\nAll commands accept --home PATH. Mutating commands use the running service.\ninit, doctor, and backup can run offline. The default state directory is .loop.\nA code workflow requires configured checks. See examples/.`); return;
  }
  if (action === 'manage') {
    const managerHome=resolve(option('--home') || process.env.Z_LOOP_MANAGER_HOME || '.loop-manager');
    const port=Number(option('--port') || 4188);
    if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid manager port');
    const manager=new Manager(managerHome);await manager.start();
    let server;
    try {server=await serveManager(manager,port);}catch(e){await manager.stop();throw e;}
    const address=server.address() as {port:number},base=`http://127.0.0.1:${address.port}`;
    print(`Repository manager: ${base}\nAccess token: ${join(managerHome,'token')}\nExisting repository services remain independent.`);
    if(!args.includes('--no-open')) {
      const child=spawn(process.platform==='darwin'?'open':'xdg-open',[`${base}/#token=${manager.token}`],{stdio:'ignore'});
      child.on('error',()=>print(`Open ${base} and enter the manager token.`));child.unref();
    }
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;server.close();await manager.stop();};
    process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());return;
  }
  if (action === 'console' && args.includes('--manager')) {
    const managerHome = resolve(option('--home') || process.env.Z_LOOP_MANAGER_HOME || '.loop-manager');
    const { base, token } = loadManagerConnection(managerHome);
    const url = `${base}/#token=${encodeURIComponent(token)}`;
    const executable = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(executable, [url], { stdio: 'ignore' });
    child.on('error', () => print(`Open ${base} and use the token stored in ${join(managerHome, 'token')}`));
    child.unref(); return;
  }
  if (action === 'init') {
    try { await access(join(home, 'config.json')); throw new Error('State directory is already initialized'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const repo = resolve(option('--repo') || '.');
    const checked = await execute(['git', 'rev-parse', '--git-dir'], { cwd: repo });
    if (checked.code) throw new Error('--repo must be a Git repository');
    const c = option('--config') ? validateConfig(await readJson(option('--config'))) : defaults(repo);
    if (!option('--config')) c.checks = await discoverChecks(repo);
    await mkdir(home, { recursive: true, mode: 0o700 });
    await atomic(join(home, 'config.json'), JSON.stringify(c, null, 2));
    await atomic(join(home, 'token'), randomBytes(32).toString('hex'));
    const store = new Store(join(home, 'state.db'), c); store.close();
    print(`Initialized ${home}\nRepository: ${c.repository}\n${c.checks.length ? `Detected ${c.checks.length} checks from the repository.` : 'No checks detected. Configure mandatory checks before code work.'}\nConfig: ${join(home, 'config.json')}\nStart: z-loop serve --home ${home}`); return;
  }
  if (action === 'serve' && needsSetup(home)) {
    const setup=await startOnboarding(home,Number(option('--port') || 4188));
    const url=`http://127.0.0.1:${setup.port}`;
    print(`First-run setup: ${url}\n${args.includes('--no-open')?'Open this address to use the three-step guide.':'Your browser will open a three-step guide.'}\nIf needed, use the access token in ${join(home,'setup-token')}.`);
    if (!args.includes('--no-open')) {
      const child=spawn(process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open',[`${url}/#token=${setup.token}`],{stdio:'ignore'});
      child.on('error',()=>print(`Open ${url} to complete setup.`));child.unref();
    }
    await setup.finished;
  }
  const config = loadConfig(home);
  if (action === 'doctor') {
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    for (const [name, argv] of [['Git', ['git', '--version']], ['Base branch', ['git', 'rev-parse', `refs/heads/${config.baseBranch}`]], ...(config.worker.kind === 'opencode' ? [['OpenCode', ['opencode', '--version']]] : []), ...(config.integration === 'github' ? [['GitHub CLI', ['gh', '--version']]] : [])] as [string, string[]][]) {
      try { const r = await execute(argv, { cwd: config.repository }); checks.push({ name, ok: r.code === 0, detail: r.code === 0 ? 'Available' : r.stderr.trim() }); }
      catch (e) { checks.push({ name, ok: false, detail: (e as Error).message }); }
    }
    checks.push({ name: 'Mandatory checks', ok: config.checks.length > 0, detail: `${config.checks.length} configured` });
    const store = new Store(join(home, 'state.db'), config);
    checks.push({ name: 'Database integrity', ok: store.one('PRAGMA integrity_check')?.integrity_check === 'ok', detail: 'SQLite integrity_check' }); store.close();
    print(checks); if (checks.some(x => !x.ok)) process.exitCode = 1; return;
  }
  if (action === 'backup') {
    const store = new Store(join(home, 'state.db'), config);
    try { print(await backupState(store, home)); } finally { store.close(); } return;
  }
  const connection=loadConnection(home,config,resolve(option('--manager-home')||process.env.Z_LOOP_MANAGER_HOME||'.loop-manager'));
  const {base,token}=connection;
  if (action === 'serve') {
    const store = new Store(join(home, 'state.db'), config);
    const controller = new Controller(store, home, new RepositoryWorkflow(home, config, store));
    let server;
    try { server = await serve(store, controller, home, (await readFile(join(home,'token'),'utf8')).trim()); await controller.start(); }
    catch (e) { server?.close(); await controller.stop(); store.close(); throw e; }
    const address = server.address();
    print(`z-loop is running at http://127.0.0.1:${typeof address === 'object' ? address?.port : config.server.port}\nOpen the authenticated console with: z-loop console --home ${home}`);
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      server.close(); await controller.stop(); store.close();
    };
    process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop()); return;
  }
  if (action === 'console') {
    const url = `${base}/#token=${encodeURIComponent(token)}`;
    const executable = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(executable, [url], { stdio: 'ignore' }); child.on('error', () => print(`Open ${base} and use the token stored in ${join(home, 'token')}`)); child.unref(); return;
  }
  let body: unknown;
  switch (action) {
    case 'status': break;
    case 'add': body = { type: 'work.create', work: await readJson(option('--file')) }; break;
    case 'automation': body = { type: 'automation.save', automation: await readJson(option('--file')) }; break;
    case 'command': body = await readJson(option('--file')); break;
    case 'pause': body = { type: 'controller.pause' }; break;
    case 'resume': body = { type: 'controller.resume' }; break;
    case 'cancel': body = { type: 'run.cancel', runId: option('--run') }; break;
    case 'retry': body = { type: 'work.rerun', workId: option('--work') }; break;
    case 'answer': body = { type: 'decision.answer', id: option('--decision'), answer: option('--text') }; break;
    default: throw new Error('Unknown command. Run z-loop help.');
  }
  if(body)body={...(body as object),operationKey:option('--operation-key')||randomUUID()};
  const response = await fetch(`${base}/api/${action === 'status' ? 'state' : 'command'}`, { method: action === 'status' ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Command failed'); print(data);
}
main().catch(e => { console.error(`Error: ${e.message}${e.cause?.code === 'ECONNREFUSED' ? '. Start the service with z-loop serve.' : ''}`); process.exitCode = 1; });
