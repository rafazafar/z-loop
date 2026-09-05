import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { defaults } from '../src/config.ts';
import { StepError } from '../src/types.ts';
import { work } from './helpers.ts';

function memory() {
  let now = 1_000_000;
  const config = defaults(process.cwd()); config.limits.retryBaseMs = 1; config.limits.leaseMs = 300;
  const store = new Store(':memory:', config, () => now);
  store.acquireController('owner');
  return { store, advance(ms: number) { now += ms; store.acquireController('owner'); } };
}
test('work deduplication and dependency validation are atomic', () => {
  const { store } = memory();
  try {
    const a = store.createWork(work({ sourceKey: 'one' }));
    assert.equal(store.createWork(work({ sourceKey: 'one' })).workId, a.workId);
    assert.throws(() => store.createWork(work({ dependencies: ['missing'] })));
    assert.equal(store.one('SELECT count(*) AS n FROM work_items')!.n, 1);
    assert.equal(store.one('SELECT count(*) AS n FROM events')!.n, 1);
  } finally { store.close(); }
});
test('one controller owns dispatch and duplicate completion is rejected', () => {
  const { store } = memory();
  try {
    store.createWork(work());
    assert.equal(store.acquireController('other'), false);
    assert.equal(store.claim('other'), null);
    const c = store.claim('owner')!;
    assert.ok(c); assert.equal(store.claim('owner'), null);
    assert.equal(store.complete(c, { summary: 'done' }), true);
    assert.equal(store.complete(c, { summary: 'duplicate' }), false);
    assert.equal(store.all('SELECT * FROM steps').length, 2);
  } finally { store.close(); }
});
test('an expired generation cannot advance a new attempt', () => {
  const { store, advance } = memory();
  try {
    store.createWork(work()); const old = store.claim('owner')!;
    advance(400);
    store.fail(old, new StepError('transient', 'lost'), true);
    advance(5); const current = store.claim('owner')!;
    assert.equal(current.attempt.generation, old.attempt.generation + 1);
    assert.equal(store.complete(old, { summary: 'late' }), false);
    assert.equal(store.complete(current, { summary: 'current' }), true);
  } finally { store.close(); }
});
test('dependency waits do not block independent work', () => {
  const { store } = memory();
  try {
    const a = store.createWork(work());
    const b = store.createWork(work({ dependencies: [a.workId], priority: 100 }));
    store.createWork(work({ title: 'Independent' }));
    assert.equal(store.claim('owner')!.work.id, a.workId);
    assert.equal(store.claim('owner')!.work.title, 'Independent');
    assert.equal(store.one('SELECT wait_kind FROM steps WHERE run_id=?', b.runId)!.wait_kind, 'dependency');
  } finally { store.close(); }
});
test('retry exhaustion creates one bounded recovery task instead of a human gate', () => {
  const { store, advance } = memory();
  try {
    store.config.limits.maxAttempts = 1;
    const a = store.createWork(work()); const claim = store.claim('owner')!;
    store.fail(claim, new StepError('contract', 'no result'));
    assert.equal(store.one('SELECT status FROM runs WHERE id=?', a.runId)!.status, 'failed');
    const recovery = store.all('SELECT * FROM work_items').find(w => w.id !== a.workId)!;
    assert.equal(JSON.parse(recovery.metadata_json).recovery, true);
    assert.equal(store.all('SELECT * FROM decisions').length, 0);
    const c = store.claim('owner')!; store.fail(c, new StepError('contract', 'still broken'));
    assert.equal(store.all('SELECT * FROM work_items').length, 2);
  } finally { store.close(); }
});
test('external decisions are validated, scoped, and resumable', () => {
  const { store } = memory();
  try {
    const a = store.createWork(work()); const first = store.claim('owner')!;
    const need = { category: 'external_fact' as const, question: 'Identifier?', reason: 'Required identifier', attempted: ['Read sources'], noSafeDefault: 'External assignment only' };
    store.complete(first, { summary: 'request validation', need });
    assert.equal(store.all('SELECT * FROM decisions').length, 0);
    const resolve = store.claim('owner')!; assert.equal(resolve.step.kind, 'resolve');
    store.complete(resolve, { summary: 'confirmed external need', need });
    const d = store.one('SELECT * FROM decisions')!;
    assert.equal(store.one('SELECT status FROM runs WHERE id=?', a.runId)!.status, 'waiting');
    store.answer(d.id, 'Use assigned identifier A');
    const resumed = store.claim('owner')!;
    assert.equal(resumed.step.kind, 'implement');
    assert.equal(JSON.parse(resumed.step.input_json).feedback, 'Use assigned identifier A');
    assert.throws(() => store.answer(d.id, 'duplicate'));
  } finally { store.close(); }
});
test('cancellation fences the active result and releases resources', () => {
  const { store } = memory();
  try {
    const a = store.createWork(work()), c = store.claim('owner')!;
    store.cancel(a.runId);
    assert.equal(store.complete(c, { summary: 'too late' }), false);
    assert.equal(store.all('SELECT * FROM resources').length, 0);
    assert.ok(store.rerun(a.workId));
  } finally { store.close(); }
});
test('operation keys reject incompatible repeated writes', () => {
  const { store } = memory();
  try {
    store.createWork(work()); const c=store.claim('owner')!;
    store.operation(c,'key','publish',{head:'a'});
    assert.equal(store.operation(c,'key','publish',{head:'a'})!.status,'pending');
    assert.throws(()=>store.operation(c,'key','publish',{head:'b'}));
    store.confirmOperation(c,'key',{remote:'confirmed'});
    assert.equal(store.operation(c,'key','publish',{head:'a'})!.status,'confirmed');
  } finally { store.close(); }
});
test('budget wait has a release time and does not block deterministic steps', () => {
  const {store}=memory();
  try {
    store.config.limits.dailyAttempts=1;
    store.createWork(work()); const c=store.claim('owner')!;store.complete(c,{summary:'done'});
    const b=store.createWork(work());
    const verify=store.claim('owner')!;assert.equal(verify.step.kind,'verify');
    assert.equal(store.claim('owner'),null);
    assert.equal(store.one('SELECT wait_kind FROM steps WHERE run_id=?',b.runId)!.wait_kind,'budget');
  } finally {store.close();}
});
test('successful recovery work resumes the original outcome once',()=>{
  const {store}=memory();
  try{
    store.config.limits.maxAttempts=1;
    const original=store.createWork(work());store.fail(store.claim('owner')!,new StepError('environment','setup defect'));
    const diagnosis=store.claim('owner')!;assert.equal(diagnosis.step.kind,'plan');
    const proposals=[{key:'repair-setup',title:'Repair setup',specification:'Fix the demonstrated setup defect',acceptance:['Setup works']}];
    store.complete(diagnosis,{summary:'plan',context:{proposals}});
    store.complete(store.claim('owner')!,{summary:'plan checked'});
    store.complete(store.claim('owner')!,{summary:'published',proposals});
    const recovery=store.one('SELECT * FROM recoveries')!;assert.equal(recovery.status,'repairing');
    const [repairId]=JSON.parse(recovery.repair_ids_json);
    store.exec("UPDATE runs SET status='succeeded' WHERE work_id=?",repairId);
    store.reconcileRecovery();store.reconcileRecovery();
    assert.equal(store.one('SELECT count(*) AS n FROM runs WHERE work_id=?',original.workId)!.n,2);
    assert.equal(store.one('SELECT status FROM recoveries')!.status,'resumed');
    const retry=store.claim('owner')!;assert.equal(retry.work.id,original.workId);
    store.fail(retry,new StepError('environment','still failing'));
    assert.equal(store.one('SELECT count(*) AS n FROM recoveries')!.n,1);
  }finally{store.close();}
});
