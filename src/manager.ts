import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { loadConfig, validateConfig } from './config.ts';
import { inspectRepository } from './onboarding.ts';
import { Store, hash } from './store.ts';
import { Controller } from './controller.ts';
import { RepositoryWorkflow } from './repository.ts';
import { serve } from './server.ts';
import { redact } from './files.ts';

interface Project { id: string; name: string; home: string; repository: string; mode: 'managed' | 'external' }
interface Runtime { store: Store; controller: Controller; server: Server }
const MODEL = "'implement','review','plan','check_plan','resolve'";
export class Manager {
  home: string;
  db!: DatabaseSync;
  token = '';
  runtimes = new Map<string, Runtime>();
  errors = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopping = false;
  private closing = false;
  private cursor = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private owner = randomBytes(16).toString('hex');
  constructor(home: string) { this.home = resolve(home); }
  async start() {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(this.home, 'manager.db'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,home TEXT UNIQUE NOT NULL,repository TEXT UNIQUE NOT NULL,mode TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),concurrency INTEGER NOT NULL,daily_attempts INTEGER NOT NULL,paused INTEGER NOT NULL);
      INSERT OR IGNORE INTO settings VALUES(1,2,100,0);
      CREATE TABLE IF NOT EXISTS operations(key TEXT PRIMARY KEY,input_json TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT);
      CREATE TABLE IF NOT EXISTS endpoint(id INTEGER PRIMARY KEY CHECK(id=1),port INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,until_at INTEGER NOT NULL);`);
    if (!this.renew()) { this.db.close(); throw new Error('Another manager owns this state directory'); }
    try {
      try { await writeFile(join(this.home, 'token'), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      this.token = (await readFile(join(this.home, 'token'), 'utf8')).trim();
      if (!/^[a-f0-9]{64}$/.test(this.token)) throw new Error('Invalid manager token');
      for (const project of this.projects()) if (project.mode === 'managed') await this.open(project);
      this.timer = setInterval(() => void this.tick().catch(e => this.errors.set('manager', redact(e.message))), 100);
    } catch(e) { await this.stop(); throw e; }
  }
  private renew() {
    return !!this.db.prepare(`INSERT INTO owner VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_at=excluded.until_at WHERE owner.owner=? OR owner.until_at<=?`).run(this.owner, Date.now()+30_000, this.owner, Date.now()).changes;
  }
  projects(): Project[] { return this.db.prepare('SELECT * FROM projects ORDER BY name,id').all() as unknown as Project[]; }
  project(id: string): Project { const p = this.projects().find(p => p.id === id); if (!p) throw new Error('Unknown repository'); return p; }
  settings() { return this.db.prepare('SELECT concurrency,daily_attempts AS dailyAttempts,paused FROM settings WHERE id=1').get() as { concurrency: number; dailyAttempts: number; paused: number }; }
  usage() {
    let running = 0, used = 0, nextBudgetAt: number | null = null;
    for (const { store } of this.runtimes.values()) {
      running += store.one("SELECT count(*) AS n FROM attempts WHERE status='running'")!.n;
      const row = store.one(`SELECT count(*) AS n,min(a.started_at) AS first FROM attempts a JOIN steps s ON s.id=a.step_id WHERE a.started_at>=? AND s.kind IN (${MODEL})`, Date.now()-86_400_000)!;
      used += row.n;
      if (row.first !== null) nextBudgetAt = Math.min(nextBudgetAt ?? Infinity, row.first+86_400_001);
    }
    return { running, used, nextBudgetAt };
  }
  private admitted(model: boolean) {
    const limits = this.settings(), usage = this.usage();
    // Missing managed stores make shared usage unknown. Stop new dispatch until recovered.
    return !this.closing && !limits.paused && this.projects().filter(p => p.mode === 'managed').length === this.runtimes.size && usage.running < limits.concurrency && (!model || usage.used < limits.dailyAttempts);
  }
  async tick() {
    if (this.busy || this.stopping) return;
    this.busy = true;
    try {
      if (!this.renew()) { this.stopping=true;if(this.timer)clearInterval(this.timer);this.errors.set('manager', 'Manager ownership was lost');await this.stopRuntimes();return; }
      const entries = [...this.runtimes.entries()];
      if (!entries.length) return;
      // Retain the next position after a claim. Rotating on empty ticks can starve a repository.
      const start=this.cursor;
      for (let n=0; n<entries.length; n++) {
        const index = (start+n)%entries.length;
        const [id, runtime] = entries[index];
        const before = runtime.store.one('SELECT count(*) AS n FROM attempts')!.n;
        try { await runtime.controller.tick(); this.errors.delete(id); }
        catch(e) { this.errors.set(id, redact((e as Error).message)); }
        if (runtime.store.one('SELECT count(*) AS n FROM attempts')!.n > before) { this.cursor=(index+1)%entries.length; }
      }
    } finally { this.busy = false; }
  }
  private async open(project: Project) {
    if (this.runtimes.has(project.id)) return;
    let store: Store | undefined, controller: Controller | undefined, server: Server | undefined;
    try {
      const read = new DatabaseSync(join(project.home, 'state.db'), { readOnly: true });
      try { if (read.prepare('SELECT 1 FROM controller WHERE lease_until>?').get(Date.now())) throw new Error('Repository still has an active controller. Existing session was left running.'); } finally { read.close(); }
      const config = loadConfig(project.home);
      if (await realpath(config.repository) !== project.repository) throw new Error('Repository identity changed');
      store = new Store(join(project.home, 'state.db'), config);
      controller = new Controller(store, project.home, new RepositoryWorkflow(project.home, config, store));
      controller.admission = model => this.admitted(model);
      await controller.start(true);
      const token = (await readFile(join(project.home, 'token'), 'utf8')).trim();
      server = await serve(store, controller, project.home, token, 0);
      this.runtimes.set(project.id, { store, controller, server });
      this.errors.delete(project.id);
    } catch(e) {
      server?.close(); if (controller) await controller.stop(); store?.close();
      this.errors.set(project.id, redact((e as Error).message));
    }
  }
  read<T>(project: Project, fn: (store: Store) => T): T {
    // Reuse query methods without opening or migrating a live repository store.
    const db=new DatabaseSync(join(project.home,'state.db'),{readOnly:true});
    const reader=Object.create(Store.prototype) as Store;reader.db=db;reader.now=Date.now;
    try { return fn(reader); } finally { db.close(); }
  }
  history(search: string, status: string, offset: number, repository?: string) {
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new Error('Invalid history offset');
    let total=0;const rows:any[]=[],errors:{id:string;error:string}[]=[];
    for(const p of this.projects().filter(p=>!repository||p.id===repository)) {
      try {
        this.read(p,store=>{
          const first=store.history(search,status,0,50);total+=first.total;
          rows.push(...first.work.map(w=>({...w,repositoryId:p.id,repositoryName:p.name})));
          // ponytail: merge local pages in memory; add a read index if large histories make this slow.
          for(let i=50;i<Math.min(first.total,offset+50);i+=200)rows.push(...store.history(search,status,i,Math.min(200,offset+50-i)).work.map(w=>({...w,repositoryId:p.id,repositoryName:p.name})));
        });
      }catch(e){errors.push({id:p.id,error:redact((e as Error).message)});}
    }
    rows.sort((a,b)=>Number(['active','waiting'].includes(b.status))-Number(['active','waiting'].includes(a.status)) || b.priority-a.priority || b.created_at-a.created_at || a.repositoryId.localeCompare(b.repositoryId) || a.id.localeCompare(b.id));
    return {work:rows.slice(offset,offset+50),total,offset,limit:50,errors};
  }
  async request(project: Project, path: string, body?: unknown) {
    if(path.startsWith('/api/events')) {const url=new URL(path,'http://127.0.0.1');return {status:200,data:this.read(project,store=>store.eventHistory(url.searchParams.get('search')||'',Number(url.searchParams.get('offset')||0))) };}
    if(path.startsWith('/api/history')) {
      const url=new URL(path,'http://127.0.0.1');
      return {status:200,data:this.read(project,store=>store.history(url.searchParams.get('search')||'',url.searchParams.get('status')||'all',Number(url.searchParams.get('offset')||0)))};
    }
    const runtime = this.runtimes.get(project.id);
    if (project.mode === 'managed' && !runtime) throw new Error(this.errors.get(project.id) || 'Managed repository is offline');
    const address = runtime?.server.address();
    const port = typeof address === 'object' && address ? address.port : loadConfig(project.home).server.port;
    const token = (await readFile(join(project.home, 'token'), 'utf8')).trim();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    const data = await response.json();
    if(path==='/api/state' && response.ok) {
      data.operational=this.read(project,store=>store.operational());
      data.runtime={...data.runtime,history:true};
      const limits=this.settings(),usage=this.usage();
      const unavailable=this.projects().some(p=>p.mode==='managed'&&!this.runtimes.has(p.id));
      data.manager={id:project.id,mode:project.mode,repositories:this.projects().map(p=>({id:p.id,name:p.name})),
        reason:project.mode==='external'?'':unavailable?'Shared usage is unknown. Restore the offline managed repository to continue.':limits.paused?'Shared dispatch is paused.':usage.running>=limits.concurrency?'Waiting for shared capacity.':usage.used>=limits.dailyAttempts?'Shared model attempt budget reached. Checks can still finish.':''};
    }
    return { status: response.status, data };
  }
  async snapshot() {
    const projects = await Promise.all(this.projects().map(async p => {
      try {
        const [{status,data},health] = await Promise.all([this.request(p,'/api/state'),this.request(p,'/health')]);
        if (status !== 200) throw new Error(data.error || 'Cannot read repository');
        return { ...p, state: data, healthy: health.status===200 && health.data.healthy===true, checkedAt: Date.now(), error: this.errors.get(p.id) || data.runtime?.error || null };
      } catch(e) { return { ...p, state: null, healthy: false, checkedAt: Date.now(), error: redact((e as Error).message) }; }
    }));
    return { projects, settings: this.settings(), usage: this.usage(), error: this.errors.get('manager') || null,
      operations: this.db.prepare("SELECT key,input_json,status,result_json FROM operations ORDER BY rowid DESC LIMIT 50").all() };
  }
  // Serialize management writes and retain their exact destination and result across retries.
  operation(key: string, input: any): Promise<{status: number; data: any}> {
    const task = this.tail.then(async () => {
      try { return await this.perform(key,input); }
      catch(e) {
        const result={status:400,data:{error:redact((e as Error).message)}};
        this.db.prepare("UPDATE operations SET status='failed',result_json=? WHERE key=? AND input_json=? AND status='prepared'").run(JSON.stringify(result),key ?? '',JSON.stringify(input));
        return result;
      }
    }); this.tail=task.catch(()=>{}); return task;
  }
  private async perform(key: string, input: any): Promise<{status: number; data: any}> {
    if(this.closing || this.stopping || !this.db.prepare('SELECT 1 FROM owner WHERE owner=? AND until_at>?').get(this.owner,Date.now()))throw new Error('Manager is not the current owner');
    if (typeof key!=='string' || !/^[a-zA-Z0-9:_-]{8,200}$/.test(key)) throw new Error('A stable operation key is required');
    const encoded=JSON.stringify(input), old=this.db.prepare('SELECT * FROM operations WHERE key=?').get(key);
    if (old && old.input_json !== encoded) throw new Error('Operation key reused with different input');
    if (old?.result_json) return JSON.parse(String(old.result_json));
    if (!old) this.db.prepare("INSERT INTO operations VALUES(?,?,'prepared',NULL)").run(key,encoded);
    let result: {status: number; data: any};
    if (input.type === 'repository.command') {
      const project=this.project(input.id);
      // Old runtimes cannot confirm a repeated command after a lost response.
      const state=await this.request(project,'/api/state');
      const safe=input.command?.type==='system.integrity' || (input.command?.type==='system.backup'?state.data.runtime?.backupReceipts:state.data.runtime?.commandReceipts);
      if (old?.status==='pending' && !safe) return {status:409,data:{unknown:true,error:'Command outcome is unknown. Inspect this repository before sending another command.',operationKey:key}};
      this.db.prepare("UPDATE operations SET status='pending' WHERE key=?").run(key);
      try { result=await this.request(project,'/api/command',{...input.command,operationKey:key}); }
      catch(e) { return {status:202,data:{unknown:true,operationKey:key,error:`Command outcome is unknown: ${redact((e as Error).message)}`}}; }
    } else {
      if(['capacity.save','manager.pause'].includes(input.type)) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const data=this.changeSettings(input),result={status:200,data};
          this.db.prepare("UPDATE operations SET status='confirmed',result_json=? WHERE key=?").run(JSON.stringify(result),key);
          this.db.exec('COMMIT');return result;
        } catch(e) {this.db.exec('ROLLBACK');throw e;}
      }
      try { result={status:200,data:await this.manage(key,input)}; }
      catch(e) { result={status:400,data:{error:redact((e as Error).message)}}; }
    }
    this.db.prepare('UPDATE operations SET status=?,result_json=? WHERE key=?').run(result.status===200?'confirmed':'failed',JSON.stringify(result),key);
    return result;
  }
  private changeSettings(input: any) {
    if (input.type === 'capacity.save') {
      if (!Number.isSafeInteger(input.concurrency) || input.concurrency<1 || input.concurrency>32 || !Number.isSafeInteger(input.dailyAttempts) || input.dailyAttempts<1 || input.dailyAttempts>10000) throw new Error('Invalid shared capacity');
      this.db.prepare('UPDATE settings SET concurrency=?,daily_attempts=? WHERE id=1').run(input.concurrency,input.dailyAttempts);return this.settings();
    }
    if (input.type === 'manager.pause') {
      if (typeof input.paused !== 'boolean') throw new Error('paused must be boolean');
      this.db.prepare('UPDATE settings SET paused=? WHERE id=1').run(Number(input.paused));return this.settings();
    }
    throw new Error('Unknown settings command');
  }
  private async manage(key: string, input: any) {
    if (input.type === 'repository.manage') {
      const p=this.project(input.id);
      // Explicit adoption is allowed only after the old controller and listener are gone.
      if (p.mode==='external') {
        try { await this.request(p,'/health'); throw new Error('Stop the existing service yourself before transferring control.'); }
        catch(e) { if ((e as Error & {cause?:{code?:string}}).cause?.code !== 'ECONNREFUSED') throw e; }
        const read=new DatabaseSync(join(p.home,'state.db'),{readOnly:true});
        try { if(read.prepare('SELECT 1 FROM controller WHERE lease_until>?').get(Date.now()))throw new Error('Existing controller lease is still active'); } finally {read.close();}
        this.db.prepare("UPDATE projects SET mode='managed' WHERE id=?").run(p.id);p.mode='managed';
      }
      await this.open(p);if(this.errors.has(p.id))throw new Error(this.errors.get(p.id));return {id:p.id};
    }
    if (!['repository.attach','repository.create'].includes(input.type)) throw new Error('Unknown manager command');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length>100) throw new Error('Enter a repository name');
    const id=hash(key).slice(0,24);
    const saved=this.projects().find(p=>p.id===id);
    if(saved) { if(saved.mode==='managed')await this.open(saved);return {id}; }
    let home: string, repository: string, mode: Project['mode'];
    if(input.type==='repository.attach') {
      if(typeof input.home!=='string' || !input.home.trim())throw new Error('Enter the existing state directory');
      home=await realpath(resolve(input.home));repository=await realpath(loadConfig(home).repository);mode='external';
    } else {
      const config=await inspectRepository(input.repository);
      if(!Array.isArray(input.checks))throw new Error('Review repository checks first');
      config.checks=input.checks;
      config.worker={kind:'opencode',...(typeof input.model==='string' && input.model.trim()?{model:input.model.trim()}:{})};
      config.limits.dailyAttempts=Number(input.dailyAttempts);config.server.port=0;validateConfig(config);
      repository=await realpath(config.repository);home=join(this.home,'repositories',id);mode='managed';
      if(this.projects().some(p=>p.repository===repository))throw new Error('This repository is already registered');
      await mkdir(home,{recursive:true,mode:0o700});
      for(const [name,value] of [['config.json',JSON.stringify(config,null,2)],['token',randomBytes(32).toString('hex')]]) {
        try {await writeFile(join(home,name),value,{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
      }
      const store=new Store(join(home,'state.db'),loadConfig(home));store.close();
    }
    if(this.projects().some(p=>p.repository===repository || p.home===home))throw new Error('This repository or state directory is already registered');
    this.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(id,input.name.trim(),home,repository,mode);
    if(mode==='managed')await this.open(this.project(id));
    return {id};
  }
  private async stopRuntimes() {
    const runtimes=[...this.runtimes.values()];
    await Promise.all(runtimes.map(async ({server,controller})=>{
      server.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),controller.stop()]);
    }));
    for(const {store} of runtimes)store.close();
    this.runtimes.clear();
  }
  async stop() {
    this.closing=true;
    await this.tail;
    this.stopping=true;if(this.timer)clearInterval(this.timer);
    while(this.busy)await new Promise(r=>setTimeout(r,10));
    await this.stopRuntimes();
    this.db.prepare('DELETE FROM owner WHERE owner=?').run(this.owner);this.db.close();
  }
}
