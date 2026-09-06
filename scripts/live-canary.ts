// Explicit opt-in. This calls a paid worker. It never uses a live remote.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaults } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { Controller } from '../src/controller.ts';
import { RepositoryWorkflow } from '../src/repository.ts';
import { execute } from '../src/process.ts';
import { atomic, sha256 } from '../src/files.ts';
if (!process.argv.includes('--live')) throw new Error('Use --live only with explicit authorization for live model calls.');
const root=resolve('.loop',`live-${Date.now()}`),repo=join(root,'repo'),home=join(root,'state');
await mkdir(repo,{recursive:true});await mkdir(home,{recursive:true});
async function git(...args:string[]){const r=await execute(['git',...args],{cwd:repo});if(r.code)throw new Error(r.stderr);return r.stdout.trim();}
await git('init','-q','-b','main');await git('config','user.name','Canary');await git('config','user.email','canary@localhost');await git('config','commit.gpgsign','false');
await writeFile(join(repo,'tags.mjs'),'export function normalizeTags(values) { return []; }\n');
const check=`import assert from 'node:assert/strict';
import {normalizeTags} from './tags.mjs';
assert.deepEqual(normalizeTags([' A ','b','a','',' B ',null,4,'C']),['a','b','c']);
assert.deepEqual(normalizeTags([]),[]);
const input=[' X ','x']; normalizeTags(input);assert.deepEqual(input,[' X ','x']);
assert.throws(()=>normalizeTags(null),TypeError);
assert.throws(()=>normalizeTags('x'),TypeError);
console.log('All independent acceptance checks passed');\n`;
await writeFile(join(repo,'check.mjs'),check);
await writeFile(join(repo,'AGENTS.md'),'Change only tags.mjs. Do not change acceptance checks. Use no dependencies.\n');
await git('add','.');await git('commit','-qm','test: seed live canary');
const config=defaults(repo);config.worker={kind:'opencode',model:'10router/combo-coding'};
config.checks=[{name:'acceptance',command:[process.execPath,'check.mjs'],cwd:'.',timeoutMs:10000}];
Object.assign(config.limits,{concurrency:1,attemptMs:300000,retryBaseMs:3000,maxAttempts:2,maxRepairs:2,dailyAttempts:12});
await atomic(join(home,'config.json'),JSON.stringify(config,null,2));
const store=new Store(join(home,'state.db'),config),controller=new Controller(store,home,new RepositoryWorkflow(home,config,store));
const results=[];
try {
  for(const workflow of ['code','plan'] as const){
    const item=store.createWork({title:workflow==='code'?'Normalize tags without changing input':'Inspect the completed tag normalizer',workflow,
      specification:workflow==='code'?'Implement normalizeTags in tags.mjs. Require an array or throw TypeError. Ignore non-string entries. Trim and lowercase strings. Drop empty strings. Remove duplicates and keep first occurrence order. Do not mutate input. Do not change checks or add dependencies.':'Inspect tags.mjs against check.mjs. Return zero proposals if no demonstrated defect remains. Do not invent work. Do not modify any repository file.',
      acceptance:workflow==='code'?['All cases in check.mjs pass.','Only tags.mjs changes.']:['Each proposal proves a concrete defect, or the plan contains zero proposals.']});
    if(workflow==='code')await controller.start();
    let previous='',start=Date.now();
    while(true){
      const run=store.one('SELECT * FROM runs WHERE id=?',item.runId)!;
      const step=store.one('SELECT kind,state,error FROM steps WHERE run_id=? ORDER BY position DESC LIMIT 1',item.runId)!;
      const status=`${workflow}: ${step.kind} ${step.state}`;
      if(status!==previous){console.log(status);previous=status;}
      if(['succeeded','failed','waiting','cancelled'].includes(run.status)){
        results.push({workflow,status:run.status,repairRounds:run.repair_count,steps:store.all('SELECT kind,state,attempt_count,failure_class FROM steps WHERE run_id=? ORDER BY position',item.runId)});
        if(run.status!=='succeeded')throw new Error(`Live ${workflow} ended ${run.status}. Inspect ${home}`);
        break;
      }
      if(Date.now()-start>900000)throw new Error(`Live ${workflow} exceeded 15 minutes`);
      await new Promise(r=>setTimeout(r,500));
    }
  }
  const independent=await execute([process.execPath,'check.mjs'],{cwd:repo});
  if(independent.code||sha256(await readFile(join(repo,'check.mjs'),'utf8'))!==sha256(check))throw new Error('Independent acceptance failed or the check changed');
  console.log(independent.stdout.trim());
} finally {
  store.setPaused(true);await controller.stop();
  await atomic(join(root,'proof.json'),JSON.stringify({model:config.worker.model,variant:'default (not supplied)',results,stateDirectory:home,attempts:store.all('SELECT status,started_at,ended_at FROM attempts')},null,2));
  console.log(`Evidence: ${root}/proof.json`);store.close();
}
