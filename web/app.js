import { setupForms } from '/forms.js';
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('token')) { sessionStorage.setItem('loop-token', fragment.get('token')); history.replaceState(null, '', location.pathname); }
let token = sessionStorage.getItem('loop-token') || '', state;
const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const date = ms => new Date(ms).toLocaleString([], { month:'short',day:'numeric',hour:'2-digit',minute:'2-digit' });
const empty = (target, title, description) => { const box = el('div', undefined, 'empty'); box.append(el('strong', title), el('span', description)); target.replaceChildren(box); };
async function api(path, body) {
  const r = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization:`Bearer ${token}`, 'content-type':'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json(); if (!r.ok) { if (r.status === 401) { $('login').hidden = false; $('console').hidden = true; } throw new Error(data.error); } return data;
}
function error(e) { const dialog=document.querySelector('dialog[open]');let target=$('error');if(dialog){target=dialog.querySelector('.form-error');if(!target){target=el('p',undefined,'form-error');target.setAttribute('role','alert');dialog.prepend(target);}}target.hidden=false;target.textContent=e.message; }
async function act(body) { $('error').hidden=true;document.querySelectorAll('.form-error').forEach(n=>n.remove());try { await api('command', body); await refresh(); return true; } catch(e) { error(e); return false; } }
function currentStep(work) { return state.steps.filter(s => s.run_id === work.run_id).sort((a,b) => b.position - a.position)[0]; }
async function detail(work) {
  let history;try{history=await api(`work?id=${encodeURIComponent(work.id)}`);}catch(e){error(e);return;}
  const latest=history.runs[0];work={...history.work,run_id:latest.id,status:latest.status};
  $('detail-title').textContent = work.title;
  const body = $('detail-body'); body.replaceChildren(el('p', work.specification));
  const criteria = el('ul'); for (const a of JSON.parse(work.acceptance_json)) criteria.append(el('li', a)); body.append(criteria);
  const actions = el('div',undefined,'detail-actions');
  if (['active','waiting'].includes(work.status)) { const cancel = el('button','Cancel run','secondary'); cancel.onclick = async () => { if (await act({type:'run.cancel',runId:work.run_id})) $('detail-dialog').close(); }; actions.append(cancel); }
  else { const retry = el('button','Start a new run','secondary'); retry.onclick = async () => { if (await act({type:'work.rerun',workId:work.id})) $('detail-dialog').close(); }; actions.append(retry); }
  body.append(actions);
  for (const run of history.runs) {
  body.append(el('h3',`Run ${run.revision} · ${run.status}`));
  for (const step of history.steps.filter(x => x.run_id === run.id).sort((a,b) => a.position-b.position)) {
    const row = el('div',undefined,'detail-step'); row.append(el('strong',`${step.position}. ${step.kind.replaceAll('_',' ')} `),el('span',step.state,`badge ${step.state}`));
    if (step.error) { const details=el('details');details.append(el('summary',step.failure_class ? `${step.failure_class} · failure details` : 'Wait details'),el('pre',step.error));row.append(details); }
    if (step.state === 'retry_scheduled' || (step.state === 'waiting' && step.wait_kind !== 'external')) row.append(el('p',`Next check: ${date(step.next_at)}`));
    const result = step.result_json && JSON.parse(step.result_json);
    if (result?.summary) row.append(el('p',result.summary));
    const paths = [];
    if (result?.artifact?.path) paths.push(result.artifact.path);
    for (const attempt of history.attempts.filter(x => x.step_id === step.id)) {
      if (['implement','review','plan','check_plan','resolve'].includes(step.kind)) paths.push(`attempts/${attempt.id}/worker.log`);
      if (step.kind==='verify') for(let i=0;i<state.configuration.config.checks.length;i++)paths.push(`attempts/${attempt.id}/check-${i}.log`);
      if (attempt.failure_json) { const failure=JSON.parse(attempt.failure_json);row.append(el('p',`Attempt ${attempt.generation} · ${attempt.status} · ${failure.category}`)); }
    }
    for (const path of paths) { const button = el('button',path.includes('/check-') ? path.split('/').pop() : path.endsWith('.log') ? 'Worker log' : 'Evidence','secondary'); button.onclick = async () => { try { const data = await api(`evidence?path=${encodeURIComponent(path)}`); const pre = el('pre',data.text); row.append(pre); button.disabled=true; } catch(e) { error(e); } }; row.append(button); }
    body.append(row);
  }}
  $('detail-dialog').showModal();
}
function render() {
  const count=status=>state.metrics.find(x=>x.status===status)?.count||0;
  const activeCount=count('active')+count('waiting');
  const running = state.attempts.filter(a => a.status === 'running').length;
  const decisions = state.decisions.filter(d => d.status === 'needs_external');
  const succeeded = count('succeeded');
  $('summary').textContent = state.paused ? 'Dispatch is paused. Active work can finish.' : `${activeCount} work item${activeCount===1?'':'s'} in progress. The runtime handles each next step.`;
  $('pause').textContent = state.paused ? 'Resume work' : 'Pause new work';
  $('stats').replaceChildren(...[['In progress',activeCount,'work items'],['Running now',running,'attempts'],['Completed',succeeded,'work items'],['External input',decisions.length,'required']].map(([label,n,note]) => { const box=el('div',undefined,'stat'); box.append(el('span',label,'stat-label'),el('span',String(n),'stat-value'),el('small',note)); return box; }));
  $('decision-count').textContent = decisions.length || '';
  const list=$('work-list'); list.replaceChildren();
  if (!state.work.length) empty(list,'Ready for the first work item','Add a bounded outcome, or enable an automation to create work.');
  const visible=state.work.filter(w=>($('filter').value==='all'||w.status===$('filter').value)&&`${w.title} ${w.specification}`.toLowerCase().includes($('search').value.toLowerCase()));
  $('work-count').textContent=`${visible.length} shown · newest 200`;
  if(state.work.length&&!visible.length)empty(list,'No matching work','Change the search or state filter.');
  for (const work of visible) {
    const step=currentStep(work), card=el('div',undefined,'work-card'); card.tabIndex=0; card.setAttribute('role','button'); card.setAttribute('aria-label',`Inspect ${work.title}`);
    const title=el('div'); title.append(el('p',work.title,'card-title'),el('div',`${work.workflow === 'code'?'Repository work':'Planning'} · Run ${work.revision} · ${date(work.created_at)}`,'card-meta'));
    const progress=el('div'); progress.append(el('div',step?.kind.replaceAll('_',' ') || 'Queued','step-label'));
    const unmet=state.dependencies.filter(d=>d.work_id===work.id).filter(d=>state.work.find(w=>w.id===d.requires_id)?.status!=='succeeded');
    progress.append(el('div',unmet.length ? `${unmet.length} dependencies pending` : step?.state === 'retry_scheduled' ? `Retry ${date(step.next_at)}` : step?.wait_kind ? `Waiting: ${step.wait_kind}` : (step?.error ? step.error.split('\n')[0].slice(0,120) : `${step?.attempt_count || 0} attempts`),'card-meta'));
    card.append(title,progress,el('span',work.status==='active' ? step?.state || 'queued' : work.status,`badge ${work.status==='active' ? step?.state : work.status}`));
    card.onclick=()=>detail(work); card.onkeydown=e=>{if(e.key==='Enter') detail(work);}; list.append(card);
  }
  const autos=$('automation-list'); autos.replaceChildren();
  if (!state.automations.length) empty(autos,'No scheduled work yet','Add a trigger with a scope, workflow, and acceptance criteria.');
  for (const a of state.automations) { const card=el('div',undefined,'automation-card'), info=el('div'); info.append(el('p',a.name,'card-title'),el('div',`${a.trigger_kind} · Every ${Math.round(a.interval_ms/1000)}s · ${a.enabled ? `Next ${date(a.next_at)}`:'Paused'}`,'card-meta')); if(a.last_error) info.append(el('p',a.last_error)); const button=el('button',a.enabled?'Pause':'Enable','secondary'); button.onclick=()=>act({type:'automation.enable',id:a.id,enabled:!a.enabled});const actions=el('div',undefined,'actions');const edit=el('button','Edit','secondary');edit.onclick=()=>forms.openAutomation(a);const scan=el('button','Scan now','secondary');scan.disabled=!a.enabled;scan.onclick=()=>act({type:'automation.scan',id:a.id});actions.append(edit,scan,button);card.append(info,actions);autos.append(card); }
  const needs=$('decision-list'); needs.replaceChildren();
  if (!decisions.length) empty(needs,'No external input needed','Routine choices stay with the automation.');
  for (const d of decisions) { const need=JSON.parse(d.body_json), card=el('form',undefined,'decision-card');card.append(el('p',need.question,'card-title'),el('p',need.reason),el('p',`Automation tried: ${need.attempted.join('; ')}`),el('p',`Why no default works: ${need.noSafeDefault}`)); const label=el('label','Required answer'), answer=el('textarea');answer.required=true;label.append(answer);card.append(label,el('button','Apply answer and continue'));card.onsubmit=async e=>{e.preventDefault();await act({type:'decision.answer',id:d.id,answer:answer.value});};needs.append(card); }
  const events=$('activity-list');events.replaceChildren();
  if (!state.events.length) empty(events,'No events yet','Accepted commands and state transitions will appear here.');
  for(const event of state.events) { const row=el('div',undefined,'event'), content=el('div');content.append(el('strong',event.type.replaceAll('.',' · ')));const data=JSON.parse(event.data_json);if(data.summary||data.message)content.append(el('p',String(data.summary||data.message).split('\n')[0]));const more=el('details');more.append(el('summary','Event details'),el('pre',JSON.stringify(data,null,2)));content.append(more);row.append(el('time',date(event.at)),content);events.append(row); }
  $('updated').textContent=`Updated ${new Date().toLocaleTimeString()}`;
}
async function refresh() {
  if(!token) { $('login').hidden=false;$('console').hidden=true;return; }
  try { state=await api('state');$('login').hidden=true;$('console').hidden=false;$('connection').textContent=state.runtime.error?'Needs attention':'Connected';if(state.runtime.error)error(new Error(state.runtime.error));render(); }
  catch(e) { $('connection').textContent='Disconnected';error(e); }
}
$('login-form').onsubmit=e=>{e.preventDefault();token=$('token').value.trim();sessionStorage.setItem('loop-token',token);refresh();};
$('pause').onclick=()=>act({type:state.paused?'controller.resume':'controller.pause'});
$('add').onclick=()=>{$('dependencies').replaceChildren(...state.work.map(w=>{const option=el('option',w.title);option.value=w.id;return option;}));$('create-dialog').showModal();};
document.querySelectorAll('.close').forEach(button=>button.onclick=()=>button.closest('dialog').close());
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===button));document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==`${button.dataset.tab}-view`);if(button.dataset.tab==='settings')forms.loadSettings();if(button.dataset.tab==='system')forms.system();});
$('create-form').onsubmit=async e=>{e.preventDefault();const ok=await act({type:'work.create',work:{title:$('title').value,specification:$('specification').value,acceptance:$('acceptance').value.split('\n').map(x=>x.trim()).filter(Boolean),workflow:$('workflow').value,priority:Number($('priority').value),dependencies:[...$('dependencies').selectedOptions].map(x=>x.value)}});if(ok){$('create-dialog').close();e.target.reset();}};
const forms=setupForms({$,el,api,act,error,getState:()=>state});
$('search').oninput=render;$('filter').onchange=render;
refresh();setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))refresh();},3000);
