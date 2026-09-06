import test from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture } from './helpers.ts';
import { startOnboarding, needsSetup } from '../src/onboarding.ts';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/store.ts';

test('first-run setup inspects without execution, validates, and persists an empty workspace',async()=>{
  const f=await fixture(),home=join(f.home,'fresh');
  const setup=await startOnboarding(home,0),base=`http://127.0.0.1:${setup.port}`;
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${setup.token}`,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  try{
    await writeFile(join(f.config.repository,'package.json'),JSON.stringify({scripts:{test:'exit 71'}}));
    assert.equal((await fetch(base)).status,200);
    assert.equal((await post('/api/setup/inspect',{repository:f.config.repository},{authorization:'Bearer wrong'})).status,401);
    assert.equal((await post('/api/setup/inspect',{repository:f.config.repository},{origin:'https://example.com'})).status,403);
    const foreignHost=await new Promise<number|undefined>((resolve,reject)=>{const req=request(base,{headers:{host:'example.com'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
    assert.equal(foreignHost,403);
    assert.equal((await post('/api/setup/inspect',{repository:join(f.home,'missing')})).status,400);
    const inspected=await (await post('/api/setup/inspect',{repository:f.config.repository})).json();
    assert.equal(inspected.checks[0].name,'test');assert.equal(needsSetup(home),true);
    const input={repository:f.config.repository,checks:inspected.checks,model:'example/model',dailyAttempts:24};
    assert.equal((await post('/api/setup/finish',{...input,dailyAttempts:0})).status,400);
    assert.equal(needsSetup(home),true);
    assert.equal((await post('/api/setup/finish',input)).status,200);
    await setup.finished;
    const config=loadConfig(home);assert.equal(config.worker.model,'example/model');assert.equal(config.worker.variant,undefined);assert.equal(config.server.port,setup.port);assert.equal(config.limits.concurrency,1);
    assert.equal((await readFile(join(home,'token'),'utf8')).trim(),setup.token);
    const store=new Store(join(home,'state.db'),config);assert.equal(store.all('SELECT * FROM work_items').length,0);store.close();
    await assert.rejects(startOnboarding(home,0),/already initialized/);
  }finally{setup.server.close();setup.server.closeAllConnections();await f.close();}
});

test('unfinished setup can restart, and a repository without detected checks can use planning',async()=>{
  const f=await fixture(),home=join(f.home,'restart');
  let setup=await startOnboarding(home,0);
  try{
    const firstToken=setup.token;
    await new Promise<void>(resolve=>setup.server.close(()=>resolve()));
    setup=await startOnboarding(home,0);assert.equal(setup.token,firstToken);
    const response=await fetch(`http://127.0.0.1:${setup.port}/api/setup/finish`,{method:'POST',headers:{authorization:`Bearer ${setup.token}`,'content-type':'application/json'},body:JSON.stringify({repository:f.repo,checks:[],model:'',dailyAttempts:24})});
    assert.equal(response.status,200);await response.json();await setup.finished;
    const config=loadConfig(home);assert.deepEqual(config.checks,[]);assert.deepEqual(config.worker,{kind:'opencode'});
    assert.equal(needsSetup(home),false);
    const store=new Store(join(home,'state.db'),config);
    assert.ok(store.createWork({title:'Inspect the fixture',specification:'Inspect only',acceptance:['Cite evidence'],workflow:'plan'}));store.close();
  }finally{setup.server.close();setup.server.closeAllConnections();await f.close();}
});
