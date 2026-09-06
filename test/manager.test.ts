import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Manager } from '../src/manager.ts';
import { serveManager } from '../src/manager-server.ts';
import { serve } from '../src/server.ts';
import { command } from '../src/commands.ts';
import { fixture, work, until } from './helpers.ts';

async function save(f: Awaited<ReturnType<typeof fixture>>, port=0) {
  if(!port) {
    const reserved=createServer();await new Promise<void>(r=>reserved.listen(0,'127.0.0.1',r));
    port=(reserved.address() as {port:number}).port;await new Promise<void>(r=>reserved.close(()=>r()));
  }
  f.config.server.port=port;
  f.store.exec("UPDATE settings SET value=? WHERE key='runtime_config'",JSON.stringify(f.config));
  await writeFile(join(f.home,'config.json'),JSON.stringify(f.config));
  await writeFile(join(f.home,'token'),'fixture-token');
}
async function attach(m:Manager,f:Awaited<ReturnType<typeof fixture>>,key:string) {
  const result=await m.operation(key,{type:'repository.attach',name:key,home:f.home});assert.equal(result.status,200);return result.data.id as string;
}

test('manager attaches to an active session without replacing ownership, settings, or attempts',async()=>{
  const f=await fixture();await f.controller.start();
  const server=await serve(f.store,f.controller,f.home,'fixture-token');
  await save(f,(server.address() as {port:number}).port);
  const m=new Manager(join(f.root,'manager'));await m.start();
  try {
    const before=f.store.one('SELECT * FROM controller'),config=await readFile(join(f.home,'config.json'),'utf8');
    const id=await attach(m,f,'attach-live-fixture');
    assert.equal(m.runtimes.size,0);assert.equal(m.project(id).mode,'external');
    const snapshot=await m.snapshot();assert.equal(snapshot.projects[0].healthy,true);
    assert.equal(f.store.one('SELECT owner FROM controller')!.owner,before!.owner);
    assert.equal(await readFile(join(f.home,'config.json'),'utf8'),config);
    assert.equal(f.store.one('SELECT count(*) AS n FROM attempts')!.n,0);
    assert.equal((await m.operation('adopt-live-fixture',{type:'repository.manage',id})).status,400);
    assert.equal(m.project(id).mode,'external');assert.equal(f.store.isOwner(f.controller.owner),true);
    const input={type:'repository.command',id,command:{type:'work.create',work:work({workflow:'plan'})}};
    const first=await m.operation('create-live-fixture',input),second=await m.operation('create-live-fixture',input);
    assert.deepEqual(first,second);assert.equal(f.store.one('SELECT count(*) AS n FROM work_items')!.n,1);
    await m.stop();assert.equal(f.store.isOwner(f.controller.owner),true);
    await until(()=>f.store.one("SELECT status FROM runs WHERE id=?",first.data.runId)?.status==='succeeded');
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.close();}
});

test('shared limits allow two repositories, bound model work, and persist on restart',async()=>{
  const a=await fixture(),b=await fixture();await save(a);await save(b);
  let m=new Manager(join(a.root,'manager'));await m.start();
  try {
    const ids=[await attach(m,a,'attach-first-repo'),await attach(m,b,'attach-second-repo')];
    await m.operation('pause-before-adopt',{type:'manager.pause',paused:true});
    for(const id of ids)assert.equal((await m.operation(`manage-${id}`,{type:'repository.manage',id})).status,200);
    await m.operation('set-shared-capacity',{type:'capacity.save',concurrency:2,dailyAttempts:2});
    const runs=await Promise.all(ids.map(id=>m.operation(`create-${id}`,{type:'repository.command',id,command:{type:'work.create',work:work()}})));
    assert.equal(m.usage().running,0);
    await m.operation('resume-shared-work',{type:'manager.pause',paused:false});
    let maxRunning=0;
    const watcher=setInterval(()=>{maxRunning=Math.max(maxRunning,m.usage().running);},10);
    try {await until(()=>m.usage().used===2 && [...m.runtimes.values()].every(r=>r.store.one("SELECT 1 FROM steps WHERE kind='review' AND state='queued'")),30000);}finally{clearInterval(watcher);}
    assert.equal(maxRunning,2);assert.equal(m.usage().used,2);
    assert.equal(a.store.one('SELECT count(*) AS n FROM attempts a JOIN steps s ON s.id=a.step_id WHERE s.kind=\'implement\'')!.n,1);
    assert.equal(b.store.one('SELECT count(*) AS n FROM attempts a JOIN steps s ON s.id=a.step_id WHERE s.kind=\'implement\'')!.n,1);
    await m.stop();m=new Manager(join(a.root,'manager'));await m.start();
    assert.equal(m.usage().used,2);assert.equal(m.settings().dailyAttempts,2);
    await m.operation('raise-shared-budget',{type:'capacity.save',concurrency:2,dailyAttempts:4});
    await until(()=>runs.every((r,i)=>[a,b][i].store.one('SELECT status FROM runs WHERE id=?',r.data.runId)!.status==='succeeded'),30000);
    assert.equal(await a.git('show','main:answer.mjs'),'export const answer = 42;');
    assert.equal(await b.git('show','main:answer.mjs'),'export const answer = 42;');
  } finally {await m.stop();await a.close();await b.close();}
});

test('complete history retains old open work and command receipts survive response loss',async()=>{
  const f=await fixture();
  try {
    const first=f.store.createWork(work({title:'Old open needle'}));
    f.store.exec('UPDATE work_items SET created_at=1 WHERE id=?',first.workId);
    for(let i=0;i<205;i++){const item=f.store.createWork(work({title:`Completed ${i}`}));f.store.cancel(item.runId);}
    assert.equal(f.store.history('needle').work[0].id,first.workId);
    assert.equal(f.store.history('', 'all',200).work.length,6);
    assert.equal(f.store.history('','open').total,1);
    assert.equal(f.store.snapshot().work[0].id,first.workId);
    const input={type:'work.rerun',workId:first.workId,operationKey:'rerun-once-fixture'};
    f.store.cancel(first.runId);const result=command(f.store,input);assert.deepEqual(command(f.store,input),result);
    assert.equal(f.store.one('SELECT count(*) AS n FROM runs WHERE work_id=?',first.workId)!.n,2);
    assert.throws(()=>command(f.store,{...input,type:'controller.pause'}),/different input/);
  }finally{await f.close();}
});

test('manager setup is authenticated, starts empty, deduplicates retries, and rejects duplicate repositories',async()=>{
  const f=await fixture(),m=new Manager(join(f.root,'manager'));await m.start();
  const server=await serveManager(m,0),base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const post=(path:string,body:unknown,extra={})=>fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${m.token}`,'content-type':'application/json',...extra},body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(base+'/api/manager/state')).status,401);
    assert.equal((await post('/api/manager/inspect',{repository:f.repo},{origin:'https://example.invalid'})).status,403);
    const inspect=await (await post('/api/manager/inspect',{repository:f.repo})).json();
    const input={operationKey:'new-managed-fixture',type:'repository.create',name:'Fixture',repository:f.repo,checks:inspect.checks,dailyAttempts:24,model:''};
    const response=await post('/api/manager/command',input);assert.equal(response.status,200);const result=await response.json();
    assert.deepEqual(await (await post('/api/manager/command',input)).json(),result);
    assert.equal(m.runtimes.get(result.id)!.store.one('SELECT count(*) AS n FROM attempts')!.n,0);
    assert.equal(m.runtimes.get(result.id)!.store.one('SELECT count(*) AS n FROM work_items')!.n,0);
    assert.equal((await post('/api/manager/command',{...input,operationKey:'another-managed-fixture'})).status,400);
    assert.equal((await post('/api/manager/command',{...input,operationKey:undefined})).status,400);
    const html=await (await fetch(base+`/r/${result.id}/`)).text();assert.match(html,/src="app.js"/);
    const headers={authorization:`Bearer ${m.token}`};
    const data=await (await fetch(base+`/r/${result.id}/api/state`,{headers})).json();assert.equal(data.configuration.config.repository,f.config.repository);
    assert.equal((await fetch(base+`/r/${result.id}/api/evidence?path=../token`,{headers})).status,400);
    assert.equal((await fetch(base+'/r/000000000000000000000000/api/state',{headers})).status,400);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await m.stop();await f.close();}
});

test('a lost legacy response remains unknown and is not sent twice',async()=>{
  const f=await fixture();let writes=0;
  const legacy=createServer((req,res)=>{
    if(req.url==='/api/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify({runtime:{},configuration:{config:f.config}}));}
    else {writes++;req.resume();req.socket.destroy();}
  });
  await new Promise<void>(r=>legacy.listen(0,'127.0.0.1',r));await save(f,(legacy.address() as {port:number}).port);
  const m=new Manager(join(f.root,'manager'));await m.start();
  try {
    const id=await attach(m,f,'attach-legacy-fixture'),input={type:'repository.command',id,command:{type:'work.rerun',workId:'fixture'}};
    const first=await m.operation('lost-response-fixture',input);assert.equal(first.status,202);assert.equal(first.data.unknown,true);
    assert.equal((await m.operation('lost-response-fixture',input)).status,409);assert.equal(writes,1);
    assert.equal(m.db.prepare('SELECT status FROM operations WHERE key=?').get('lost-response-fixture')!.status,'pending');
    assert.equal((await m.operation('refuse-reset-transfer',{type:'repository.manage',id})).status,400);
    assert.equal(m.project(id).mode,'external');
  }finally{legacy.closeAllConnections();await new Promise<void>(r=>legacy.close(()=>r()));await m.stop();await f.close();}
});

test('manager ownership excludes a second dispatcher and historical queries remain repository scoped',async()=>{
  const a=await fixture(),b=await fixture();await save(a);await save(b);
  const m=new Manager(join(a.root,'manager'));await m.start();
  try {
    const duplicate=new Manager(m.home);await assert.rejects(duplicate.start(),/Another manager/);
    await m.operation('pause-receipt-fixture',{type:'manager.pause',paused:true});
    await m.operation('resume-receipt-fixture',{type:'manager.pause',paused:false});
    await m.operation('pause-receipt-fixture',{type:'manager.pause',paused:true});
    assert.equal(m.settings().paused,0);
    const idA=await attach(m,a,'scope-first-repo'),idB=await attach(m,b,'scope-second-repo');
    const first=a.store.createWork(work({title:'Only first repository'}));
    b.store.createWork(work({title:'Only second repository'}));
    for(let i=0;i<110;i++){const item=a.store.createWork(work({title:`Archive ${i}`}));a.store.cancel(item.runId);}
    const page=m.history('','all',50);assert.equal(page.total,112);assert.equal(page.work.length,50);
    assert.equal(m.history('Only','all',0,idB).work[0].repositoryId,idB);
    assert.equal(m.history('first','all',0,idB).total,0);
    assert.equal(m.history('first','all',0,idA).work[0].id,first.workId);
    assert.equal(a.store.eventHistory('work.created').total,111);
    assert.equal(a.store.eventHistory('work.created',100).events.length,11);
    assert.equal(b.store.eventHistory('work.created').total,1);
  } finally {await m.stop();await a.close();await b.close();}
});

test('a recovered lost attempt remains charged to the shared model budget',async()=>{
  const f=await fixture();await save(f);
  const item=f.store.createWork(work());f.store.acquireController('old-fixture');
  const claim=f.store.claim('old-fixture')!;assert.ok(claim);
  f.store.exec('UPDATE attempts SET lease_until=0');f.store.exec('UPDATE controller SET lease_until=0');
  const m=new Manager(join(f.root,'manager'));await m.start();
  try {
    await m.operation('limit-recovered-attempt',{type:'capacity.save',concurrency:1,dailyAttempts:1});
    const id=await attach(m,f,'attach-recovery-fixture');
    assert.equal((await m.operation('manage-recovery-fixture',{type:'repository.manage',id})).status,200);
    await until(()=>f.store.one('SELECT status FROM attempts WHERE id=?',claim.attempt.id)!.status==='lost');
    assert.equal(m.usage().used,1);assert.equal(m.usage().running,0);
    await m.tick();assert.equal(f.store.one('SELECT count(*) AS n FROM attempts')!.n,1);
    assert.notEqual(f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status,'succeeded');
  } finally {await m.stop();await f.close();}
});

test('lost responses from receipt-capable runtimes reconcile to one write',async()=>{
  const f=await fixture();let writes=0;
  const proxy=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/state'){res.end(JSON.stringify({runtime:{commandReceipts:true}}));return;}
    let body='';for await(const chunk of req)body+=chunk;
    const result=command(f.store,JSON.parse(body));writes++;
    if(writes===1)req.socket.destroy();else res.end(JSON.stringify(result));
  });
  await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));await save(f,(proxy.address() as {port:number}).port);
  const m=new Manager(join(f.root,'manager'));await m.start();
  try {
    const id=await attach(m,f,'attach-receipt-fixture'),input={type:'repository.command',id,command:{type:'work.create',work:work()}};
    assert.equal((await m.operation('recover-write-fixture',input)).status,202);
    const recovered=await m.operation('recover-write-fixture',input);assert.equal(recovered.status,200);
    assert.equal(writes,2);assert.equal(f.store.one('SELECT count(*) AS n FROM work_items')!.n,1);
    assert.deepEqual(await m.operation('recover-write-fixture',input),recovered);assert.equal(writes,2);
  } finally {proxy.closeAllConnections();await new Promise<void>(r=>proxy.close(()=>r()));await m.stop();await f.close();}
});

test('the manager replaces the saved public port without changing repository settings or CLI access',async()=>{
  const f=await fixture();await save(f);f.store.setPaused(true);
  const saved=f.store.one("SELECT value FROM settings WHERE key='runtime_config'")!.value;
  const m=new Manager(join(f.root,'manager'));await m.start();let server;
  try {
    const id=await attach(m,f,'single-address-attach');
    assert.equal((await m.operation('single-address-manage',{type:'repository.manage',id})).status,200);
    server=await serveManager(m,f.config.server.port);
    const runtime=m.runtimes.get(id)!;
    assert.notEqual((runtime.server.address() as {port:number}).port,f.config.server.port);
    const {loadConnection}=await import('../src/config.ts');
    const connection=loadConnection(f.home,f.config,m.home);
    assert.equal(connection.base,`http://127.0.0.1:${f.config.server.port}/r/${id}`);
    const response=await fetch(`${connection.base}/api/state`,{headers:{authorization:`Bearer ${connection.token}`}});
    assert.equal(response.status,200);const state=await response.json();assert.equal(state.paused,true);
    assert.equal(state.configuration.config.repository,f.config.repository);
    assert.equal(f.store.one("SELECT value FROM settings WHERE key='runtime_config'")!.value,saved);
  }finally{server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));await m.stop();await f.close();}
});
