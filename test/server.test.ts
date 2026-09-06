import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, work } from './helpers.ts';
import { serve } from '../src/server.ts';
import { backupState } from '../src/backup.ts';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

test('API requires a token and rejects cross-origin commands',async()=>{
  const f=await fixture();const server=await serve(f.store,f.controller,f.home,'fixture-token');
  try{
    const port=(server.address() as {port:number}).port,base=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/state`)).status,401);
    const headers={authorization:'Bearer fixture-token','content-type':'application/json'};
    assert.equal((await fetch(`${base}/api/command`,{method:'POST',headers:{...headers,origin:'https://untrusted.invalid'},body:JSON.stringify({type:'work.create',work:work()})})).status,403);
    const create=await fetch(`${base}/api/command`,{method:'POST',headers,body:JSON.stringify({type:'work.create',work:work({title:'<script>unsafe</script>'})})});assert.equal(create.status,200);
    const response=await fetch(`${base}/api/state`,{headers});assert.equal(response.status,200);assert.equal((await response.json()).work.length,1);
    assert.equal((await fetch(`${base}/api/evidence?path=../config.json`,{headers})).status,400);
    const page=await fetch(base);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
    assert.doesNotMatch(await page.text(),/<script>unsafe/);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.close();}
});
test('a drained backup retains relational state and passes integrity check',async()=>{
  const f=await fixture();
  try{
    const item=f.store.createWork(work());
    await assert.rejects(backupState(f.store,f.home),/Pause/);
    f.store.setPaused(true);const backup=await backupState(f.store,f.home,'backup-retry-fixture');
    f.store.setPaused(false);assert.equal(await backupState(f.store,f.home,'backup-retry-fixture'),backup);
    const db=new DatabaseSync(join(backup,'state.db'));
    try{assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(db.prepare('SELECT work_id FROM runs').get()!.work_id,item.workId);}finally{db.close();}
  }finally{await f.close();}
});
