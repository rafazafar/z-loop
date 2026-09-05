import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, work } from './helpers.ts';
import { RepositoryWorkflow } from '../src/repository.ts';
import { atomic, sha256 } from '../src/files.ts';
import { checkDigest } from '../src/config.ts';
import type { StepKind } from '../src/types.ts';

async function scenario(kind:StepKind, options:{merged?:boolean;pending?:boolean;headChanged?:boolean;baseChanged?:boolean;lookupFailure?:boolean}={}){
  const f=await fixture();f.config.integration='github';f.config.githubRepository='fixture/project';
  const item=f.store.createWork(work()),head='a'.repeat(40),base='b'.repeat(40);
  const artifact=async(name:string,data:unknown)=>{const path=`${name}.json`,content=JSON.stringify(data);await atomic(join(f.home,path),content);return{path,sha256:sha256(content)};};
  const checks=checkDigest(f.config);
  const verification={head,base,checks,artifact:await artifact('verification',{status:'passed',head,base,checks,records:[{exit:0}]})};
  const review={head,base,artifact:await artifact('review',{outcome:'pass',head,base})};
  f.store.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify({workspace:f.home,head,base,verification,review,pr:{number:7}}),item.runId);
  f.store.exec('UPDATE steps SET kind=? WHERE run_id=?',kind,item.runId);f.store.acquireController('fixture');const claim=f.store.claim('fixture')!;
  const calls:string[][]=[];let merged=options.merged||false;
  const workflow=new RepositoryWorkflow(f.home,f.config,f.store);
  workflow.git=async(cwd,args)=>{
    calls.push(['git',...args]);return{code:0,stderr:'',elapsedMs:1,stdout:args[0]==='remote'?'fixture-remote':`${head}\trefs/heads/fixture`};
  };
  workflow.gh=async args=>{
    calls.push(['gh',...args]);let response:unknown;
    if(args[1]==='list')response=[{number:7,state:'OPEN',url:'https://example.invalid/pr/7',headRefOid:options.headChanged?'c'.repeat(40):head,baseRefName:'main'}];
    else if(args[1]==='checks')response=options.lookupFailure?[]:[{name:'required',bucket:options.pending?'pending':'pass'}];
    else if(args[1]==='merge'){merged=true;response={};}
    else response={state:merged?'MERGED':'OPEN',headRefOid:options.headChanged?'c'.repeat(40):head,baseRefOid:options.baseChanged?'d'.repeat(40):base,mergeStateStatus:'CLEAN',mergeCommit:{oid:head}};
    return{code:options.lookupFailure&&args[1]==='checks'?1:0,stdout:JSON.stringify(response),stderr:'',elapsedMs:1};
  };
  return{f,head,calls,run:()=>workflow.run(claim,new AbortController().signal)};
}
test('publication reuses an existing PR after uncertain creation',async()=>{
  const s=await scenario('publish');try{const r=await s.run();assert.match(r.summary,/7/);assert.equal(s.calls.some(c=>c.includes('create')),false);assert.equal(s.f.store.one('SELECT status FROM operations')!.status,'confirmed');}finally{await s.f.close();}
});
test('GitHub merge binds the reviewed SHA and never bypasses protections',async()=>{
  const s=await scenario('integrate');try{await s.run();const merge=s.calls.find(c=>c[2]==='merge')!;assert.ok(merge.includes('--match-head-commit'));assert.ok(merge.includes(s.head));assert.equal(merge.includes('--admin'),false);}finally{await s.f.close();}
});
test('an already merged PR is reconciled without another merge',async()=>{
  const s=await scenario('integrate',{merged:true});try{await s.run();assert.equal(s.calls.some(c=>c[2]==='merge'),false);}finally{await s.f.close();}
});
for(const options of [{pending:true},{headChanged:true},{baseChanged:true},{lookupFailure:true}]){
  test(`GitHub gate rejects ${Object.keys(options)[0]}`,async()=>{
    const s=await scenario('integrate',options);try{await assert.rejects(s.run());assert.equal(s.calls.some(c=>c[2]==='merge'),false);}finally{await s.f.close();}
  });
}
