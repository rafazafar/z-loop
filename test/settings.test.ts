import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, work } from './helpers.ts';
import { Store } from '../src/store.ts';
import { loadConfig } from '../src/config.ts';
import { configuration, saveConfiguration, applyConfiguration } from '../src/settings.ts';
import { command } from '../src/commands.ts';

test('configuration drains attempts, fences concurrent edits, and survives restart', async () => {
  const f=await fixture();
  try {
    f.store.createWork(work());f.store.acquireController('test');
    const claim=f.store.claim('test')!;
    const next=structuredClone(f.config);next.limits.concurrency=4;
    saveConfiguration(f.store,next,1);
    assert.equal(applyConfiguration(f.store),false);
    assert.equal(f.config.limits.concurrency,2);
    assert.equal(f.store.claim('test'),null);
    assert.throws(()=>saveConfiguration(f.store,next,1),/changed/);
    f.store.complete(claim,{summary:'Saved fixture result'});
    assert.equal(applyConfiguration(f.store),true);
    assert.equal(f.config.limits.concurrency,4);
    assert.equal(configuration(f.store).revision,2);
    assert.throws(()=>saveConfiguration(f.store,next,1),/changed/);
    const restored=loadConfig(f.home);assert.equal(restored.limits.concurrency,4);
    const reopened=new Store(join(f.home,'state.db'),restored);
    assert.equal(configuration(reopened).revision,2);reopened.close();
  } finally { await f.close(); }
});
test('integration settings cannot change under open work and pending changes can be cancelled',async()=>{
  const f=await fixture();
  try{
    f.store.createWork(work());const next=structuredClone(f.config);next.baseBranch='develop';
    assert.throws(()=>saveConfiguration(f.store,next,1),/open runs/);
    next.baseBranch='main';next.limits.dailyAttempts=50;saveConfiguration(f.store,next,1);
    command(f.store,{type:'configuration.cancel'});assert.equal(configuration(f.store).pending,null);
    assert.equal(f.config.limits.dailyAttempts,100);
    f.store.exec("INSERT INTO settings VALUES('maintenance_until',?)",String(Date.now()+60000));
    assert.throws(()=>command(f.store,{type:'controller.resume'}),/Backup/);
  }finally{await f.close();}
});
test('work history includes each run and its attempts',async()=>{
  const f=await fixture();
  try{const item=f.store.createWork(work());f.store.acquireController('test');f.store.claim('test');f.store.cancel(item.runId);f.store.rerun(item.workId);
    const detail=f.store.detail(item.workId);assert.equal(detail.runs.length,2);assert.equal(detail.attempts.length,1);assert.equal(detail.steps.length,2);
  }finally{await f.close();}
});

test('standard defaults create refinement work only after the main outcome passes',async()=>{
  const f=await fixture();
  try {
    const item=f.store.createWork(work({workflow:'plan'}));f.store.acquireController('test');
    const original=f.store.claim('test')!;
    f.store.complete(original,{summary:'Resolve default',need:{category:'external_fact',question:'Which format?',reason:'Format unspecified',attempted:['Inspect conventions'],noSafeDefault:'Needs independent check'}});
    const resolver=f.store.claim('test')!;
    f.store.complete(resolver,{summary:'Use the standard',defaultChoice:{choice:'Use repository conventions',refinement:{key:'format',title:'Review the chosen format',specification:'Review the default after the outcome ships.',acceptance:['The decision is supported by use.']}}});
    assert.equal(f.store.snapshot().work.length,1);
    for(const summary of ['Plan complete','Plan checked','No new code work'])f.store.complete(f.store.claim('test')!,{summary,proposals:[]});
    assert.equal(f.store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status,'succeeded');
    assert.equal(f.store.snapshot().work.length,2);
  }finally{await f.close();}
});

test('maximum-size specifications still produce a bounded diagnosis on failure',async()=>{
  const f=await fixture();
  try{
    f.config.limits.maxAttempts=1;
    f.store.createWork(work({specification:'x'.repeat(100000)}));f.store.acquireController('test');
    const { StepError }=await import('../src/types.ts');
    assert.equal(f.store.fail(f.store.claim('test')!,new StepError('environment','Worker unavailable')),true);
    assert.equal(f.store.snapshot().work.length,2);
    assert.equal(f.store.one("SELECT count(*) AS n FROM attempts WHERE status='running'")!.n,0);
  }finally{await f.close();}
});
