// Run only against the disposable state created by npm run demo.
import { resolve, join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { Controller } from '../src/controller.ts';
import { RepositoryWorkflow } from '../src/repository.ts';
import { serve } from '../src/server.ts';
const home=resolve(process.argv[2]||'');
const config=loadConfig(home);
if(config.worker.kind!=='command'||!config.worker.command?.some(x=>x.endsWith('/examples/fixture-worker.mjs')))throw new Error('Preview requires the fixture worker.');
const store=new Store(join(home,'state.db'),config);store.setPaused(true);
config.server.port=4198;
const controller=new Controller(store,home,new RepositoryWorkflow(home,config,store));
const server=await serve(store,controller,home,'fixture-preview');await controller.start();
console.log('Fixture preview: http://127.0.0.1:4198/#token=fixture-preview');
const stop=async()=>{server.close();await controller.stop();store.close();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
