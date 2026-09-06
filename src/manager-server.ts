import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Manager } from './manager.ts';
import { inspectRepository } from './onboarding.ts';
import { redact } from './files.ts';

export async function serveManager(manager: Manager, port = 4188) {
  const server=createServer(async(req,res)=>{
    const send=(status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('x-content-type-options','nosniff');
    try {
      const active=(server.address() as {port:number}).port;
      if(req.headers.host!==`127.0.0.1:${active}`){send(403,{error:'Use the local manager address'});return;}
      const url=new URL(req.url||'/','http://127.0.0.1');
      const route=url.pathname.match(/^\/r\/([a-f0-9]{24})\/(.*)$/);
      const assets:Record<string,string>={'/':'manager.html','/manager.js':'manager.js','/style.css':'style.css','/manager.css':'manager.css'};
      const scoped:Record<string,string>={'':'index.html','app.js':'app.js','forms.js':'forms.js','style.css':'style.css'};
      const file=route?scoped[route[2]]:assets[url.pathname];
      if(req.method==='GET' && file){
        if(route)manager.project(route[1]);
        const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
        let content=await readFile(new URL(`../web/${file}`,import.meta.url),'utf8');
        if(route && file==='index.html')content=content.replaceAll('href="/style.css"','href="style.css"').replaceAll('src="/app.js"','src="app.js"');
        res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(content);return;
      }
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');
      if(Buffer.byteLength(token)!==Buffer.byteLength(manager.token)||!timingSafeEqual(Buffer.from(token),Buffer.from(manager.token))){send(401,{error:'Enter the manager access token'});return;}
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`){send(403,{error:'Cross-origin commands are disabled'});return;}
      let body:any;
      if(req.method==='POST'){
        let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>200_000)throw new Error('Input is too large');}body=JSON.parse(text);
      }
      if(route){
        const project=manager.project(route[1]),path=`/${route[2]}`;
        if(req.method==='GET' && ['/api/state','/api/events','/api/history','/api/work','/api/evidence','/api/system','/health'].includes(path)){
          const result=await manager.request(project,path+url.search);send(result.status,result.data);return;
        }
        if(req.method==='POST' && path==='/api/command'){
          const {operationKey,...command}=body;
          const result=await manager.operation(operationKey,{type:'repository.command',id:project.id,command});send(result.status,result.data);return;
        }
      }
      if(req.method==='GET' && url.pathname==='/api/manager/work'){send(200,manager.history(url.searchParams.get('search')||'',url.searchParams.get('status')||'all',Number(url.searchParams.get('offset')||0),url.searchParams.get('repository')||undefined));return;}
      if(req.method==='GET' && url.pathname==='/api/manager/state'){send(200,await manager.snapshot());return;}
      if(req.method==='POST' && url.pathname==='/api/manager/inspect'){send(200,await inspectRepository(body.repository));return;}
      if(req.method==='POST' && url.pathname==='/api/manager/command'){
        const {operationKey,...input}=body;const result=await manager.operation(operationKey,input);send(result.status,result.data);return;
      }
      send(404,{error:'Unknown manager request'});
    }catch(e){send(400,{error:redact((e as Error).message)});}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  manager.db.prepare('INSERT INTO endpoint VALUES(1,?) ON CONFLICT(id) DO UPDATE SET port=excluded.port').run((server.address() as {port:number}).port);
  return server;
}
