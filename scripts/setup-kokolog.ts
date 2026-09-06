// Configure one local repository. Starting the service is a separate command.
import { readFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Check } from '../src/types.ts';
import { defaults } from '../src/config.ts';
import { execute } from '../src/process.ts';
import { atomic } from '../src/files.ts';
import { Store } from '../src/store.ts';
import { defineAutomation } from '../src/automations.ts';
const repo=resolve(process.argv[2]||'../kokolog-monitor'),home=resolve(process.argv[3]||'.loop/kokolog-monitor');
try{await access(join(home,'state.db'));throw new Error('State exists. Use the console to edit it.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const config=defaults(repo);config.worker={kind:'opencode',model:'10router/combo-coding',timeoutMs:300000};
config.server.port=4188;Object.assign(config.limits,{concurrency:1,dailyAttempts:24,attemptMs:1200000,maxRepairs:3,maxAttempts:3});
const check=(name:string,command:string[],cwd='.',timeoutMs=600000):Check=>({name,command,cwd,timeoutMs});
config.checks=[check('flutter-dependencies',['flutter','pub','get','--enforce-lockfile'])];
const manifest=await readFile(join(repo,'pubspec.yaml'),'utf8');
const workspace=manifest.split('workspace:\n')[1].split('\ndev_dependencies:')[0].split('\n').map(x=>x.match(/^  - (.+)$/)?.[1]).filter(Boolean) as string[];
for(const cwd of workspace){
  const pubspec=await readFile(join(repo,cwd,'pubspec.yaml'),'utf8');const tool=/sdk: flutter/.test(pubspec)?'flutter':'dart';
  config.checks.push(check(`${cwd}:analyze`,[tool,'analyze'],cwd));
  try{await access(join(repo,cwd,'test'));config.checks.push(check(`${cwd}:test`,[tool,'test'],cwd));}catch{}
}
config.checks.push(check('node-dependencies',['pnpm','install','--frozen-lockfile']),check('benchmark-dependencies',['npm','ci','--ignore-scripts'],'tools/benchmark/subscribers'),check('lab-tests',['pnpm','--dir','tools/lab','test']),
  check('tooling-tests',['node','--test','tools/document-link-routing.test.mjs','tools/drive-sync/sync-drive-cmp.test.mjs','tools/drive-sync/push-drive-cmp.test.mjs','tools/spec-tools/generate-traceability-matrix.test.mjs']),
  check('release-docs',['dart','tool/validate_release_docs.dart'],'packages/flutter/hrm_sdk'));
for(const check of config.checks){
  check.setup=check.name.endsWith('-dependencies');
  if(check.setup)continue;
  check.paths=check.name==='lab-tests'?['tools/lab/**','tools/benchmark/subscribers/**','pnpm*','package*.json']:
    check.name==='tooling-tests'?['tools/**','docs/**','README.md','.github/**','package*.json','pnpm*','skills-lock.json']:
    ['apps/**','packages/**','pubspec.*','.github/workflows/**','docs/releases/**'];
}
await mkdir(home,{recursive:true,mode:0o700});
const venv=join(home,'tools-venv');
for(const command of [['python3','-m','venv',venv],[join(venv,'bin','pip'),'install','cryptography==50.0.1','jsonschema==4.26.0','openapi-spec-validator==0.9.0','pyyaml==6.0.3','ruff==0.16.5']]){
 const result=await execute(command,{cwd:home,timeoutMs:600000});if(result.code)throw new Error(result.stderr);
}
config.checks.push({...check('contracts',[join(venv,'bin','python'),'tools/contracts/validate_contracts.py']),paths:['docs/contracts/**','tools/contracts/**','docs/compliance/QMS006*','.github/workflows/contracts.yml']});
await atomic(join(home,'config.json'),JSON.stringify(config,null,2));await atomic(join(home,'token'),randomBytes(32).toString('hex'));
const store=new Store(join(home,'state.db'),config);store.setPaused(true);
defineAutomation(store,{name:'Repository maintenance watch',enabled:true,trigger:'interval',watchHead:true,intervalMs:60000,work:{workflow:'plan',title:'Inspect kokolog-monitor for actionable maintenance',
  specification:'Inspect the current repository, README, applicable ARD decisions, and the supplied queue context. Find at most one concrete defect that can be reproduced and fixed with automated checks. Prefer a failing check or an incomplete approved requirement. Do not invent work or duplicate open work. Return no proposals when no supported defect remains. Keep each proposed outcome bounded. Follow controlled Japanese documentation rules. Keep runtime internals out of this repository. Do not publish releases, contact third parties, or claim physical evidence from mocks. Routine reversible choices use repository standards; record later refinement after the outcome passes.',
  acceptance:['Each proposal cites a reproducible defect or an explicit approved requirement.','Each proposal specifies automated acceptance checks and relevant existing project decisions.','The plan has at most one proposal and does not duplicate open work.']}});
console.log(JSON.stringify({home,repository:repo,model:config.worker.model,thinking:'default',checks:config.checks.length,watchEverySeconds:60,paused:true},null,2));store.close();
