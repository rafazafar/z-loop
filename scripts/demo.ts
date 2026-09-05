import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { defaults } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { Controller } from '../src/controller.ts';
import { RepositoryWorkflow } from '../src/repository.ts';
import { execute } from '../src/process.ts';
import { atomic } from '../src/files.ts';

const root = resolve('.loop', `demo-${Date.now()}`), repo = join(root,'repo'), home=join(root,'state');
await mkdir(repo,{recursive:true});await mkdir(home,{recursive:true});
async function git(...args:string[]){const r=await execute(['git',...args],{cwd:repo});if(r.code)throw new Error(r.stderr);return r.stdout.trim();}
await git('init','-q','-b','main');await git('config','user.name','Fixture');await git('config','user.email','fixture@localhost');await git('config','commit.gpgsign','false');
await writeFile(join(repo,'answer.mjs'),'export const answer = 0;\n');
await writeFile(join(repo,'check.mjs'),"import {answer} from './answer.mjs'; if(answer!==42)throw new Error('Expected 42');console.log('Acceptance passed: answer is 42');\n");
await git('add','.');await git('commit','-qm','test: initialize demo');
const config=defaults(repo);config.worker={kind:'command',command:[process.execPath,fileURLToPath(new URL('../examples/fixture-worker.mjs',import.meta.url))]};
config.checks=[{name:'acceptance',command:[process.execPath,'check.mjs'],cwd:'.',timeoutMs:5000}];config.limits.retryBaseMs=100;config.server.port=4188;
await atomic(join(home,'config.json'),JSON.stringify(config,null,2));await atomic(join(home,'token'),randomBytes(32).toString('hex'));
const store=new Store(join(home,'state.db'),config),controller=new Controller(store,home,new RepositoryWorkflow(home,config,store));
const item=store.createWork({title:'Recover a failed implementation and deliver the correct answer',specification:'Set answer to 42. The fixture intentionally produces 41 on the first attempt.',acceptance:['The committed answer is 42.','The mandatory check passes.'],metadata:{mode:'repair'}});
try{
  await controller.start();const start=Date.now();
  while(!['succeeded','failed'].includes(store.one('SELECT status FROM runs WHERE id=?',item.runId)!.status)){
    if(Date.now()-start>60_000)throw new Error('Demo timed out');await new Promise(r=>setTimeout(r,100));
  }
  const run=store.one('SELECT * FROM runs WHERE id=?',item.runId)!;
  const proof={status:run.status,repairRounds:run.repair_count,steps:store.all('SELECT kind,state,attempt_count FROM steps WHERE run_id=? ORDER BY position',item.runId),answer:(await readFile(join(repo,'answer.mjs'),'utf8')).trim(),stateDirectory:home};
  await atomic(join(root,'proof.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof,null,2));
  if(run.status!=='succeeded')process.exitCode=1;
  console.log(`\nInspect this completed demo:\n./bin/z-loop serve --home ${home}\n./bin/z-loop console --home ${home}`);
}finally{await controller.stop();store.close();}
