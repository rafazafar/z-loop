import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, utimes, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, work } from './helpers.ts';
import { Scheduler, defineAutomation, deleteAutomation } from '../src/automations.ts';
import { command } from '../src/commands.ts';
import { validateAgentResult, validateProposals } from '../src/agent.ts';

test('interval scheduling deduplicates and coalesces overlapping runs',async()=>{
  const f=await fixture();
  try{
    const id=defineAutomation(f.store,{name:'Maintenance',enabled:true,trigger:'interval',intervalMs:1000,work:work({workflow:'plan'})});
    const scheduler=new Scheduler(f.store),signal=new AbortController().signal;
    await scheduler.tick(signal);await scheduler.tick(signal);
    assert.equal(f.store.all('SELECT * FROM runs').length,1);
    f.store.exec('UPDATE automations SET next_at=0 WHERE id=?',id);await scheduler.tick(signal);
    assert.equal(f.store.all('SELECT * FROM runs').length,1);
    assert.equal(f.store.all('SELECT * FROM trigger_receipts').length,1);
  }finally{await f.close();}
});
test('file scheduling binds work to content and ignores unchanged inputs',async()=>{
  const f=await fixture();
  try{
    await mkdir(join(f.repo,'notes'));const file=join(f.repo,'notes','meeting.md');await writeFile(file,'Approved change one');await utimes(file,0,0);
    const id=defineAutomation(f.store,{name:'Notes',enabled:true,trigger:'files',path:'notes',intervalMs:100,work:work({workflow:'plan'})});
    const scheduler=new Scheduler(f.store),signal=new AbortController().signal;
    await scheduler.tick(signal);f.store.exec('UPDATE automations SET next_at=0');await scheduler.tick(signal);
    assert.equal(f.store.all('SELECT * FROM work_items').length,1);
    await writeFile(file,'Approved change two');await utimes(file,0,0);f.store.exec('UPDATE automations SET next_at=0');await scheduler.tick(signal);
    assert.equal(f.store.all('SELECT * FROM work_items').length,2);
    f.store.exec('UPDATE automations SET enabled=0,next_at=0 WHERE id=?',id);await scheduler.tick(signal);
    assert.equal(f.store.all('SELECT * FROM work_items').length,2);
  }finally{await f.close();}
});
test('file triggers reject paths outside the repository',async()=>{
  const f=await fixture();
  try{
    assert.throws(()=>defineAutomation(f.store,{name:'bad',enabled:true,trigger:'files',path:'../',intervalMs:100,work:work()}));
    await symlink(f.home,join(f.repo,'escape'));
    defineAutomation(f.store,{name:'bad symlink',enabled:true,trigger:'files',path:'escape',intervalMs:100,work:work()});
    await new Scheduler(f.store).tick(new AbortController().signal);
    assert.equal(f.store.all('SELECT * FROM work_items').length,0);
    assert.match(f.store.one('SELECT last_error FROM automations')!.last_error,/escapes/);
  }finally{await f.close();}
});
test('agent output rejects malformed verdicts, vague human gates, and cyclic plans',()=>{
  assert.throws(()=>validateAgentResult({version:1,outcome:'pass',summary:'done'},'review'));
  assert.throws(()=>validateAgentResult({version:1,outcome:'needs_external',summary:'ask',need:{question:'Proceed?'}},'implement'));
  const p=(key:string,dependsOn:string[])=>({key,dependsOn,title:key,specification:'work',acceptance:['prove it']});
  assert.throws(()=>validateProposals([p('a',['b']),p('b',['a'])]));
  assert.equal(validateProposals([p('b',['a']),p('a',[])]).length,2);
});

test('commit watching scans without model work until the base revision changes',async()=>{
 const f=await fixture();
 try{
  defineAutomation(f.store,{name:'Commit watch',enabled:true,trigger:'interval',watchHead:true,intervalMs:100,work:work({workflow:'plan'})});
  const scheduler=new Scheduler(f.store),signal=new AbortController().signal;
  await scheduler.tick(signal);assert.equal(f.store.snapshot().work.length,1);
  f.store.cancel(f.store.snapshot().work[0].run_id);
  f.store.exec('UPDATE automations SET next_at=0');await scheduler.tick(signal);assert.equal(f.store.snapshot().work.length,1);
  await f.git('commit','--allow-empty','-qm','test: new watched revision');
  f.store.exec('UPDATE automations SET next_at=0');await scheduler.tick(signal);assert.equal(f.store.snapshot().work.length,2);
 }finally{await f.close();}
});

test('file-source forms can explicitly disable commit watching',async()=>{
 const f=await fixture();
 try{
  assert.ok(defineAutomation(f.store,{name:'Files',enabled:true,trigger:'files',watchHead:false,path:'.',intervalMs:100,work:work()}));
  assert.throws(()=>defineAutomation(f.store,{name:'Invalid',enabled:true,trigger:'files',watchHead:true,path:'.',intervalMs:100,work:work()}),/Commit watching/);
 }finally{await f.close();}
});

test('automations can be deleted directly and through the command handler',async()=>{
 const f=await fixture();
 try{
  const id=defineAutomation(f.store,{name:'To delete',enabled:true,trigger:'interval',intervalMs:1000,work:work()});
  assert.equal(f.store.all('SELECT * FROM automations WHERE id=?',id).length,1);
  const res=command(f.store,{type:'automation.delete',id}) as {deleted:boolean};
  assert.equal(res.deleted,true);
  assert.equal(f.store.all('SELECT * FROM automations WHERE id=?',id).length,0);
  assert.throws(()=>deleteAutomation(f.store,id),/Unknown automation/);
 }finally{await f.close();}
});

test('github issue trigger validates filterBlocked definition',async()=>{
 const f=await fixture();
 f.store.config.githubRepository = 'owner/repo';
 try{
  assert.ok(defineAutomation(f.store,{name:'GH 1',enabled:true,trigger:'github',label:'ready',filterBlocked:true,intervalMs:1000,work:work()}));
  assert.ok(defineAutomation(f.store,{name:'GH 2',enabled:true,trigger:'github',label:'ready',filterBlocked:false,intervalMs:1000,work:work()}));
  assert.throws(()=>defineAutomation(f.store,{name:'Invalid',enabled:true,trigger:'github',label:'ready',filterBlocked:'yes' as any,intervalMs:1000,work:work()}),/Invalid filterBlocked/);
 }finally{await f.close();}
});

test('read-only worker roles can write their result but cannot edit source or ask direct questions',async()=>{
 const {workerPermissions}=await import('../src/agent.ts');
 const output='/checkout/.git/z-loop/result.json';const p=workerPermissions('review',output);
 assert.equal(typeof p.edit,'object');assert.equal((p.edit as Record<string,string>)['*'],'deny');
 assert.equal((p.edit as Record<string,string>)[output],'allow');assert.equal(p.question,'deny');
 assert.equal(workerPermissions('implement',output).edit,'allow');
});
