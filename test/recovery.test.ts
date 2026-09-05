import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fixture, work, until } from './helpers.ts';
import { Controller } from '../src/controller.ts';
import { RepositoryWorkflow } from '../src/repository.ts';
import { atomic } from '../src/files.ts';
import { hash } from '../src/store.ts';
import { execute } from '../src/process.ts';
import { fileURLToPath } from 'node:url';

test('a saved receipt is adopted after controller loss without repeating the step', async()=>{
  const f=await fixture();
  try {
    f.store.acquireController('crashed');f.store.createWork(work());const c=f.store.claim('crashed')!;
    const result={summary:'durably completed'};
    await atomic(join(f.home,'attempts',c.attempt.id,'receipt.json'),JSON.stringify({attempt:c.attempt.id,generation:c.attempt.generation,result,digest:hash(result)}));
    f.store.exec('UPDATE controller SET lease_until=0');f.store.exec('UPDATE attempts SET lease_until=0');
    f.store.setPaused(true);await f.controller.start();
    assert.equal(f.store.one('SELECT status FROM attempts WHERE id=?',c.attempt.id)!.status,'succeeded');
    assert.equal(f.store.one("SELECT count(*) AS n FROM events WHERE type='attempt.recovered'")!.n,1);
    assert.equal(f.store.one('SELECT kind FROM steps ORDER BY position DESC LIMIT 1')!.kind,'verify');
  }finally{await f.close();}
});
test('missing and corrupt receipts become retries, never success',async()=>{
  const f=await fixture();
  try {
    f.store.acquireController('crashed');f.store.createWork(work());const c=f.store.claim('crashed')!;
    await atomic(join(f.home,'attempts',c.attempt.id,'receipt.json'),'{broken');
    f.store.exec('UPDATE controller SET lease_until=0');f.store.exec('UPDATE attempts SET lease_until=0');
    f.store.setPaused(true);await f.controller.start();
    assert.equal(f.store.one('SELECT status FROM attempts WHERE id=?',c.attempt.id)!.status,'lost');
    assert.equal(f.store.one('SELECT state FROM steps WHERE id=?',c.step.id)!.state,'retry_scheduled');
  }finally{await f.close();}
});
test('integration reconciles a lost response without another merge',async()=>{
  const f=await fixture();
  const delegate=new RepositoryWorkflow(f.home,f.config,f.store);
  const controller=new Controller(f.store,f.home,{async run(claim,signal){
    const result=await delegate.run(claim,signal);
    if(claim.step.kind==='integrate'&&claim.step.attempt_count===1) throw new Error('Lost response after external write');
    return result;
  }});
  try {
    const item=f.store.createWork(work());await controller.start();
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status==='succeeded');
    assert.equal(Number(await f.git('rev-list','--count','main')),2);
    assert.equal(f.store.one("SELECT count(*) AS n FROM operations WHERE kind='integrate'")!.n,1);
    assert.equal(f.store.one("SELECT attempt_count FROM steps WHERE run_id=? AND kind='integrate'",item.runId)!.attempt_count,2);
  }finally{await controller.stop();await f.close();}
});
test('base drift returns to repair and repeats verification',async()=>{
  const f=await fixture();const delegate=new RepositoryWorkflow(f.home,f.config,f.store);let changed=false;
  const controller=new Controller(f.store,f.home,{async run(claim,signal){
    if(claim.step.kind==='integrate'&&!changed){changed=true;await f.git('commit','--allow-empty','-qm','chore: concurrent base update');}
    return delegate.run(claim,signal);
  }});
  try {
    const item=f.store.createWork(work());await controller.start();
    await until(()=>['succeeded','failed'].includes(f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status));
    assert.equal(f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status,'succeeded',JSON.stringify(f.store.snapshot().events));
    assert.equal(f.store.one('SELECT repair_count FROM runs WHERE id=?',item.runId)!.repair_count,1);
    assert.equal(f.store.one("SELECT count(*) AS n FROM steps WHERE run_id=? AND kind='verify'",item.runId)!.n,2);
  }finally{await controller.stop();await f.close();}
});
test('corrupt assurance evidence cannot be integrated',async()=>{
  const f=await fixture();const delegate=new RepositoryWorkflow(f.home,f.config,f.store);
  const controller=new Controller(f.store,f.home,{async run(claim,signal){
    if(claim.step.kind==='integrate') {
      const context=JSON.parse(claim.run.context_json);
      await atomic(join(f.home,context.verification.artifact.path),'{}');
    }
    return delegate.run(claim,signal);
  }});
  try {
    f.config.limits.maxAttempts=1;const item=f.store.createWork(work());await controller.start();
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status==='failed');
    assert.match(await readFile(join(f.repo,'answer.mjs'),'utf8'),/0/);
    assert.equal(f.store.all('SELECT * FROM operations').length,0);
  }finally{await controller.stop();await f.close();}
});
test('process output is captured and timeouts terminate execution',async()=>{
  const f=await fixture();
  try {
    const log=join(f.home,'output.log');
    const r=await execute([process.execPath,'-e',"console.log('actual stdout');console.error('actual stderr');process.exit(7)"],{cwd:f.repo,log});
    assert.equal(r.code,7);assert.match(await readFile(log,'utf8'),/actual stdout/);assert.match(await readFile(log,'utf8'),/actual stderr/);
    await assert.rejects(execute([process.execPath,'-e','setInterval(()=>{},1000)'],{cwd:f.repo,timeoutMs:50}),/timeout/);
  }finally{await f.close();}
});
test('SQLite rolls back an interrupted transition and retains an acknowledged one',async()=>{
  const f=await fixture();
  try{
    const module=new URL('../src/store.ts',import.meta.url).href;
    const script=`import {Store} from ${JSON.stringify(module)};const s=new Store(process.argv[1],JSON.parse(process.argv[2]));if(process.argv[3]==='before')s.event=()=>process.exit(71);s.createWork({title:'Crash fixture',specification:'Atomic outcome',acceptance:['One work record'],sourceKey:process.argv[3]});process.exit(72);`;
    const before=await execute([process.execPath,'--experimental-strip-types','--input-type=module','-e',script,join(f.home,'state.db'),JSON.stringify(f.config),'before'],{cwd:f.repo});
    assert.equal(before.code,71);assert.equal(f.store.all('SELECT * FROM work_items').length,0);
    const after=await execute([process.execPath,'--experimental-strip-types','--input-type=module','-e',script,join(f.home,'state.db'),JSON.stringify(f.config),'after'],{cwd:f.repo});
    assert.equal(after.code,72);assert.equal(f.store.all('SELECT * FROM work_items').length,1);
    assert.equal(f.store.one('PRAGMA integrity_check')!.integrity_check,'ok');
  }finally{await f.close();}
});
test('the independent process supervisor stops work when its controller is absent',async()=>{
  const f=await fixture();
  try{
    const wrapper=fileURLToPath(new URL('../src/process-worker.mjs',import.meta.url));
    // This fixture uses an absent PID, rather than killing the test runner.
    const result=await execute([process.execPath,wrapper,JSON.stringify({argv:[process.execPath,'-e','setInterval(()=>{},1000)'],cwd:f.repo,parentPid:2147483647,timeoutMs:5000})],{cwd:f.repo,timeoutMs:3000});
    assert.notEqual(result.code,0);assert.ok(result.elapsedMs<2500);
  }finally{await f.close();}
});
