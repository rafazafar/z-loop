// Disposable UI fixture. No paid workers or live remotes.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fixture, work } from '../test/helpers.ts';
import { Manager } from '../src/manager.ts';
import { serveManager } from '../src/manager-server.ts';
import { serve } from '../src/server.ts';

const fixtures=await Promise.all([fixture(),fixture(),fixture()]);
const manager=new Manager(join(fixtures[0].root,'manager'));
await manager.start();manager.token='fixture-ui-token';
await manager.operation('fixture-pause-manager',{type:'manager.pause',paused:true});
let external: Awaited<ReturnType<typeof serve>> | undefined;
for(const [i,f] of fixtures.entries()) {
  await writeFile(join(f.home,'token'),'fixture-token');
  if(i===2)continue;
  if(i===0) {const reserved=createServer();await new Promise<void>(r=>reserved.listen(0,'127.0.0.1',r));f.config.server.port=(reserved.address() as {port:number}).port;await new Promise<void>(r=>reserved.close(()=>r()));f.store.exec("UPDATE settings SET value=? WHERE key='runtime_config'",JSON.stringify(f.config));}
  if(i===1) {
    f.store.setPaused(true);await f.controller.start();external=await serve(f.store,f.controller,f.home,'fixture-token');
    f.config.server.port=(external.address() as {port:number}).port;
    f.store.exec("UPDATE settings SET value=? WHERE key='runtime_config'",JSON.stringify(f.config));
  }
  await writeFile(join(f.home,'config.json'),JSON.stringify(f.config));
  const attached=await manager.operation(`fixture-attach-${i}`,{type:'repository.attach',home:f.home,name:['Storefront','Device SDK'][i]});
  if(i===0)await manager.operation('fixture-manage-first',{type:'repository.manage',id:attached.data.id});
  f.store.createWork(work({title:i?'Check device reconnection':'Fix account settings layout'}));
  for(let n=0;n<65;n++){const item=f.store.createWork(work({title:`Historical task ${n}`}));f.store.cancel(item.runId);}
}
const server=await serveManager(manager,0);
console.log(JSON.stringify({url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,newRepository:fixtures[2].repo,existingHome:fixtures[1].home}));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;server.closeAllConnections();server.close();external?.closeAllConnections();external?.close();await manager.stop();for(const f of fixtures)await f.close();}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
