import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, work, until } from './helpers.ts';

for (const mode of ['normal','repair','missing-once']) {
  test(`complete repository workflow: ${mode}`, async () => {
    const f=await fixture();
    try {
      const item=f.store.createWork(work({metadata:{mode}}));
      await f.controller.start();
      await until(()=>['succeeded','failed'].includes(f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status));
      const run=f.store.one('SELECT * FROM runs WHERE id=?',item.runId)!;
      assert.equal(run.status,'succeeded',JSON.stringify(f.store.snapshot().events));
      assert.match(await readFile(join(f.repo,'answer.mjs'),'utf8'),/42/);
      assert.equal(await f.git('status','--porcelain'),'');
      assert.equal(f.store.one("SELECT count(*) AS n FROM operations WHERE status='confirmed'")!.n,1);
      const verify=f.store.all("SELECT result_json FROM steps WHERE run_id=? AND kind='verify' AND result_json IS NOT NULL",item.runId).map(x=>JSON.parse(x.result_json)).find(x=>x.artifact);
      const proof=JSON.parse(await readFile(join(f.home,verify.artifact.path),'utf8'));
      const log=await readFile(join(f.home,proof.records[0].log),'utf8');
      assert.match(log,/checked answer 42/);assert.match(log,/workspaces/);
      if(mode==='repair') assert.equal(run.repair_count,1);
      if(mode==='missing-once') assert.equal(f.store.one("SELECT count(*) AS n FROM attempts WHERE status='failed'")!.n,1);
    } finally {await f.close();}
  });
}
test('a review mutation cannot reach integration',async()=>{
  const f=await fixture();
  try {
    f.config.limits.maxAttempts=1;
    const item=f.store.createWork(work({metadata:{mode:'mutating-review'}}));await f.controller.start();
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status==='failed');
    assert.match(await readFile(join(f.repo,'answer.mjs'),'utf8'),/0/);
    assert.equal(f.store.all('SELECT * FROM operations').length,0);
  }finally{await f.close();}
});
test('verified planning publishes dependency-ordered work without a human gate',async()=>{
  const f=await fixture();
  try {
    const item=f.store.createWork(work({workflow:'plan',metadata:{proposals:[
      {key:'second',title:'Second outcome',specification:'Confirm answer 42',acceptance:['Answer is 42'],dependsOn:['first']},
      {key:'first',title:'First outcome',specification:'Set answer to 42',acceptance:['Answer is 42']}
    ]}}));await f.controller.start();
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status==='succeeded');
    assert.equal(f.store.all('SELECT * FROM work_items').length,3);
    assert.equal(f.store.all('SELECT * FROM dependencies').length,1);
    assert.equal(f.store.all('SELECT * FROM decisions').length,0);
  }finally{await f.close();}
});
test('missing checks fail closed instead of certifying an untested change',async()=>{
  const f=await fixture();
  try {
    f.config.checks=[];f.config.limits.maxAttempts=1;
    const item=f.store.createWork(work());await f.controller.start();
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status==='failed');
    assert.equal(f.store.all('SELECT * FROM operations').length,0);
  }finally{await f.close();}
});

test('path-scoped verification runs setup and matching checks, with immutable evidence',async()=>{
  const f=await fixture();
  try{
    f.config.checks[0].paths=['answer.mjs'];
    f.config.checks.unshift({name:'setup',setup:true,command:[process.execPath,'-e','process.exit(0)'],cwd:'.',timeoutMs:5000});
    f.config.checks.push({name:'unrelated',paths:['unrelated/**'],command:[process.execPath,'-e','process.exit(1)'],cwd:'.',timeoutMs:5000});
    const item=f.store.createWork(work());await f.controller.start();
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status==='succeeded');
    const artifact=f.store.one("SELECT * FROM artifacts WHERE kind='verification'")!;
    const {readFile}=await import('node:fs/promises');const {join}=await import('node:path');
    const proof=JSON.parse(await readFile(join(f.home,artifact.path),'utf8'));
    assert.deepEqual(proof.records.map((r:any)=>r.name),['setup','answer']);
  }finally{await f.close();}
});

test('a worker timeout is independent of the longer verification deadline',async()=>{
 const f=await fixture();
 try{
  f.config.worker={kind:'command',command:[process.execPath,'-e','setTimeout(()=>{},10000)'],timeoutMs:1000};
  f.store.createWork(work());f.store.acquireController('test');const claim=f.store.claim('test')!;
  const {runAgent}=await import('../src/agent.ts');const {mkdir}=await import('node:fs/promises');const {join}=await import('node:path');
  const dir=join(f.home,'attempts',claim.attempt.id);await mkdir(dir,{recursive:true});
  const started=Date.now();await assert.rejects(runAgent(f.config,claim,f.repo,dir,{},new AbortController().signal),/Process stopped: timeout/);
  assert.ok(Date.now()-started<5000);
 }finally{await f.close();}
});
