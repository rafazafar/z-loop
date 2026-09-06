import { createServer } from 'node:http';
import { readFile, mkdir, link, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { defaults, validateConfig } from './config.ts';
import { discoverChecks } from './initialize.ts';
import { execute } from './process.ts';
import { atomic } from './files.ts';
import { Store } from './store.ts';

export function needsSetup(home: string) {
  return !existsSync(join(home, 'config.json')) && !existsSync(join(home, 'state.db'));
}
export async function inspectRepository(input: string) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Enter the path to a Git repository.');
  const repository = await realpath(resolve(input.startsWith('~/') ? join(homedir(), input.slice(2)) : input));
  const git = async (args: string[]) => {
    const result = await execute(['git', ...args], { cwd: repository, timeoutMs: 10_000 });
    if (result.code !== 0) throw new Error('Choose a Git repository with at least one commit.');
    return result.stdout.trim();
  };
  const root = await git(['rev-parse', '--show-toplevel']);
  await git(['rev-parse', '--verify', 'HEAD']);
  const branch = await git(['symbolic-ref', '--short', 'HEAD']);
  const config = defaults(root);config.baseBranch = branch;
  config.checks = await discoverChecks(root);
  // Installation commands prepare dependencies; they do not prove correctness.
  for (const check of config.checks) if (check.name === 'dependencies') check.setup = true;
  config.limits.concurrency = 1;config.limits.dailyAttempts = 24;
  return config;
}

export async function startOnboarding(home: string, port = 4188) {
  if (!needsSetup(home)) throw new Error('This state directory is already initialized.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid setup port.');
  await mkdir(home, { recursive: true, mode: 0o700 });
  const tokenPath=join(home,'token');
  const candidate=randomBytes(32).toString('hex');
  const tokenTemp=join(home,`.setup-token-${candidate.slice(0,12)}`);
  await atomic(tokenTemp,candidate);
  try { await link(tokenTemp,tokenPath); } catch(e) { if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e; } finally { await rm(tokenTemp,{force:true}); }
  const token=(await readFile(tokenPath,'utf8')).trim();
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('The existing access token is invalid. Choose a new state directory.');
  let complete!: () => void;
  const finished = new Promise<void>(resolve => { complete = resolve; });
  let saving = false;
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });res.end(JSON.stringify(body)); };
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('x-content-type-options', 'nosniff');
    try {
      const address = server.address();const activePort = typeof address === 'object' && address ? address.port : port;
      if (req.headers.host !== `127.0.0.1:${activePort}`) { send(403, { error: 'Use the local setup address.' });return; }
      const path = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const assets: Record<string, [string,string]> = { '/':['onboarding.html','text/html'], '/onboarding.js':['onboarding.js','text/javascript'], '/style.css':['style.css','text/css'] };
      if (req.method === 'GET' && assets[path]) {
        const [file,type] = assets[path];res.writeHead(200, { 'content-type':type,'cache-control':'no-store' });res.end(await readFile(new URL(`../web/${file}`, import.meta.url)));return;
      }
      const supplied = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(token))) { send(401,{error:'Use the setup link or the access token printed by the startup instructions.'});return; }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { send(403,{error:'Cross-origin setup is disabled.'});return; }
      if (req.method !== 'POST' || !['/api/setup/inspect','/api/setup/finish'].includes(path)) { send(404,{error:'Unknown setup request.'});return; }
      let body='';for await (const chunk of req) { body+=chunk;if(Buffer.byteLength(body)>100_000)throw new Error('Setup input is too large.'); }
      const input=JSON.parse(body);
      if (path.endsWith('/inspect')) { send(200,await inspectRepository(input.repository));return; }
      if (saving || !needsSetup(home)) { send(409,{error:'Setup is already complete or being saved.'});return; }
      saving=true;
      try {
        const config=await inspectRepository(input.repository);
        if (!Array.isArray(input.checks)) throw new Error('Review the checks before continuing.');
        config.checks=input.checks;
        config.worker={kind:'opencode',...(typeof input.model==='string' && input.model.trim()?{model:input.model.trim()}: {})};
        config.limits.dailyAttempts=Number(input.dailyAttempts);
        config.server.port=activePort;
        validateConfig(config);
        const configTemp=join(home,`.setup-config-${randomBytes(8).toString('hex')}`);
        await atomic(configTemp,JSON.stringify(config,null,2));
        try { await link(configTemp,join(home,'config.json')); } finally { await rm(configTemp,{force:true}); }
        const store=new Store(join(home,'state.db'),config);store.close();
        res.once('finish',()=>{server.close(()=>complete());});
        send(200,{ready:true});
      } finally { saving=false; }
    } catch(e) { send(400,{error:(e as Error).message}); }
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  await atomic(join(home,'setup-token'),token);
  const address=server.address() as {port:number};
  return {server,token,port:address.port,finished};
}
