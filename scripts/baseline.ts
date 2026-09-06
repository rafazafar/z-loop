import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { execute } from '../src/process.ts';
import { atomic } from '../src/files.ts';
const home=resolve(process.argv[2]||'.loop/kokolog-monitor'),config=loadConfig(home),root=join(home,`baseline-${Date.now()}`),repo=join(root,'repo');
await mkdir(root,{recursive:true});
const clone=await execute(['git','-c','core.hooksPath=/dev/null','clone','--no-hardlinks',config.repository,repo],{cwd:root,timeoutMs:120000});
if(clone.code)throw new Error(clone.stderr);
const head=await execute(['git','rev-parse','HEAD'],{cwd:repo});const results=[];
console.log(`Baseline: ${root}`);
for(const [i,check] of config.checks.entries()){
  console.log(`START ${check.name}`);
  try{const result=await execute(check.command,{cwd:join(repo,check.cwd),timeoutMs:check.timeoutMs,log:join(root,`check-${i}.log`)});results.push({name:check.name,exit:result.code,elapsedMs:result.elapsedMs,log:`check-${i}.log`});console.log(`EXIT ${result.code} ${check.name}`);}
  catch(e){results.push({name:check.name,exit:-1,error:(e as Error).message,log:`check-${i}.log`});console.log(`ERROR ${check.name}: ${(e as Error).message}`);}
  await atomic(join(root,'proof.json'),JSON.stringify({head:head.stdout.trim(),results},null,2));
}
const dirty=await execute(['git','status','--porcelain'],{cwd:repo});
await atomic(join(root,'proof.json'),JSON.stringify({head:head.stdout.trim(),results,trackedChanges:dirty.stdout},null,2));
console.log(`${results.filter(x=>x.exit===0).length}/${results.length} checks passed`);if(results.some(x=>x.exit!==0)||dirty.stdout.trim())process.exitCode=1;
