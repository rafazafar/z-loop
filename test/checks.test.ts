import test from 'node:test';
import assert from 'node:assert/strict';
import {selectChecks,matchesPath} from '../src/checks.ts';
const check=(name:string,paths?:string[],setup=false)=>({name,paths,setup,command:['true'],cwd:'.',timeoutMs:1000});
test('scoped checks retain setup and all checks for each changed path',()=>{
 const checks=[check('deps',undefined,true),check('sdk',['packages/**']),check('lab',['tools/**']),check('global')];
 assert.deepEqual(selectChecks(checks,['packages/sdk/main.dart']).map(c=>c.name),['deps','sdk','global']);
 assert.equal(selectChecks(checks,['packages/sdk/main.dart','tools/lab/a.js']).length,4);
 assert.equal(matchesPath('package.json','package.*'),true);
 assert.equal(matchesPath('packages/sdk/a.dart','packages/*'),false);
});
test('setup alone and uncovered changed files fail closed',()=>{
 assert.throws(()=>selectChecks([check('deps',undefined,true)],['a']),/No mandatory/);
 assert.throws(()=>selectChecks([check('sdk',['packages/**'])],['packages/a','tools/b']),/tools\/b/);
});
