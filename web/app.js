import { setupForms } from '/forms.js';
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('token')) { sessionStorage.setItem('loop-token', fragment.get('token')); history.replaceState(null, '', location.pathname); }
let decisionSignature='';
const human = value => ({retry_scheduled:'Retry scheduled',queued:'Queued',running:'Running',active:'In progress',waiting:'Waiting',succeeded:'Completed',failed:'Failed',cancelled:'Cancelled'}[value] || value?.replaceAll('_',' '));
let token = sessionStorage.getItem('loop-token') || '', state;
const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const date = ms => new Date(ms).toLocaleString([], { month:'short',day:'numeric',hour:'2-digit',minute:'2-digit' });
const empty = (target, title, description) => { const box = el('div', undefined, 'empty'); box.append(el('strong', title), el('span', description)); target.replaceChildren(box); };
async function api(path, body) {
  const r = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization:`Bearer ${token}`, 'content-type':'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json(); if (!r.ok) { if (r.status === 401) { $('login').hidden = false; $('console').hidden = true; } throw new Error(data.error); } return data;
}
function error(e) { const dialog=document.querySelector('dialog[open]');let target=$('error');if(dialog){target=dialog.querySelector('.form-error');if(!target){target=el('p',undefined,'form-error');target.setAttribute('role','alert');dialog.prepend(target);}}target.hidden=false;target.textContent=e.message; }
let commandBusy=false;
async function act(body) { if(commandBusy)return false;commandBusy=true; $('error').hidden=true;document.querySelectorAll('.form-error').forEach(n=>n.remove());try { await api('command', body); await refresh();$('feedback').textContent=({'automation.scan':'Source check requested. New work appears in the queue when a source is ready.','automation.save':'Automation saved.','automation.enable':'Automation status saved.','automation.delete':'Automation deleted. Existing work stays in the queue.','work.create':'Work added to the queue.','decision.answer':'Answer saved. The loop can continue.'}[body.type] || 'Change saved.'); return true; } catch(e) { error(e); return false; } finally {commandBusy=false;} }
function currentStep(work) { return state.steps.filter(s => s.run_id === work.run_id).sort((a,b) => b.position - a.position)[0]; }

async function detail(work) {
  const sameWork=$('detail-dialog').open && $('detail-dialog').dataset.work===work.id;
  const selectedPanel=sameWork?$('detail-body').querySelector('[aria-selected=true]')?.getAttribute('aria-controls'):null;
  const expanded=sameWork?new Map([...$('detail-body').querySelectorAll('details[data-key]')].map(n=>[n.dataset.key,n.open])):new Map();
  let history;try{history=await api(`work?id=${encodeURIComponent(work.id)}`);}catch(e){error(e);return;}
  const latest=history.runs[0];work={...history.work,run_id:latest.id,status:latest.status};

  const meta=work.metadata_json ? JSON.parse(work.metadata_json) : {};
  const source=work.source_key?.match(/^github:([^:]+):(\d+)$/);
  const ghRepo=source?.[1] || state.configuration?.config?.githubRepository;
  const issue=source?.[2] || meta.githubIssue;
  const steps=history.steps.filter(s=>s.run_id===latest.id).sort((a,b)=>a.position-b.position);
  const current=steps.at(-1), context=JSON.parse(latest.context_json || '{}');
  const stepNames={implement:'Implementation',verify:'Verification',review:'Review',publish:'Publication',integrate:'Integration',observe:'Completion',plan:'Planning',check_plan:'Plan review',apply_plan:'Create work',resolve:'Resolve input'};
  const activeAttempt=history.attempts.find(a=>a.step_id===current?.id&&a.status==='running');
  const dialog=$('detail-dialog'), body=$('detail-body');
  dialog.dataset.work=work.id;dialog.setAttribute('aria-labelledby','detail-title');
  $('detail-title').textContent=work.title;
  body.replaceChildren();dialog.querySelectorAll('.form-error').forEach(n=>n.remove());
  const mast=el('div',undefined,'work-mast');
  mast.append(el('span',human(work.status),`badge ${work.status}`),el('span',`${work.workflow==='plan'?'Planning':'Implementation'} · Run ${latest.revision}`,'help'));
  const links=el('div',undefined,'work-links'), seen=new Set();
  const addLink=(label,url)=>{
    try {const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='github.com'||parsed.username||parsed.password||!/^\/[^/]+\/[^/]+\/(issues|pull)\/\d+$/.test(parsed.pathname)||seen.has(parsed.href))return;seen.add(parsed.href);
      const link=el('a',`${label} ↗`,'work-link');link.href=parsed.href;link.target='_blank';link.rel='noopener noreferrer';links.append(link);
    }catch{}
  };
  if(issue && ghRepo)addLink(`Source issue #${issue}`,`https://github.com/${ghRepo}/issues/${issue}`);
  // Planned work keeps its parent work ID in the stable source key.
  // Follow that stored relationship; do not infer origin from issue numbers in prose.
  let ancestor=work;const visited=new Set([work.id]);
  for(let depth=0;depth<8;depth++){
    const parent=ancestor.source_key?.match(/^plan:([0-9a-f-]{36}):/)?.[1];
    if(!parent||visited.has(parent))break;visited.add(parent);
    try {ancestor=(await api(`work?id=${encodeURIComponent(parent)}`)).work;}catch{break;}
    const origin=ancestor.source_key?.match(/^github:([^:]+):(\d+)$/);
    if(origin)addLink(`Source issue #${origin[2]} · parent work`,`https://github.com/${origin[1]}/issues/${origin[2]}`);
  }
  for(const run of history.runs){const pr=JSON.parse(run.context_json || '{}').pr;if(pr?.url)addLink(`PR #${pr.number} · Run ${run.revision}`,pr.url);}
  if(!history.runs.some(r=>JSON.parse(r.context_json || '{}').pr?.url))links.append(el('span','No PR recorded','link-empty'));
  mast.append(links);
  body.append(mast);
  const navigation=el('div',undefined,'detail-tabs');navigation.setAttribute('role','tablist');navigation.setAttribute('aria-label','Work details');
  const overview=el('section',undefined,'work-overview'), timeline=el('section',undefined,'work-timeline');
  overview.id='work-overview';timeline.id='work-timeline';
  const tabs=[];
  for(const [name,panel] of [['Overview',overview],[`Run history (${history.runs.length})`,timeline]]){
    const button=el('button',name,'secondary');button.id=`${panel.id}-tab`;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);
    panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
    button.onclick=()=>{for(const [tab,target] of tabs){const selected=tab===button;target.hidden=!selected;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}};
    button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?tabs.length-1:(tabs.findIndex(([t])=>t===button)+1)%tabs.length;tabs[index][0].click();tabs[index][0].focus();}};
    tabs.push([button,panel]);navigation.append(button);
  }
  body.append(navigation,overview,timeline);(tabs.find(([,p])=>p.id===selectedPanel)||tabs[0])[0].click();
  const summary=el('div',undefined,`work-outcome outcome-${work.status}`);
  const result=current?.result_json && JSON.parse(current.result_json);
  const statusText=work.status==='succeeded'?'Work completed':work.status==='failed'?'Run stopped':work.status==='cancelled'?'Run cancelled':current?.wait_kind==='external'?'External input required':current?.state==='retry_scheduled'?'Retry scheduled':current?.state==='running'?`${stepNames[current.kind] || human(current.kind)} in progress`:state.paused?'Dispatch is paused':`Next step: ${human(current?.kind) || 'Queued'}`;
  summary.append(el('h3',statusText));
  summary.append(el('p',work.status==='failed'?(current?.error?.split('\n')[0]||'Open run history for the failure evidence.'):(work.status==='cancelled'?'This run will not continue. Start a new run to try again.':current?.wait_kind==='external'?'Open External input from the dashboard to provide the required answer.':current?.state==='waiting'?(current.error?.split('\n')[0]||'The loop is waiting for a required condition.'):current?.state==='running'?(activeAttempt?`Attempt ${activeAttempt.generation} · Started ${date(activeAttempt.started_at)}`:'The worker is executing this step.'):result?.summary) || (state.paused?'Resume dispatch from the queue to start the next attempt.':'The loop will run the next available step.')));
  if(current?.state==='retry_scheduled')summary.append(el('p',`Next attempt: ${date(current.next_at)}`,'help'));
  if(context.integrated){const commit=el('code',`Commit ${context.integrated.slice(0,12)}`,'integrated-commit');commit.title=context.integrated;summary.append(commit);}
  overview.append(summary);
  const stages=el('div',undefined,'work-stages');stages.setAttribute('aria-label','Latest run steps');
  for(const step of steps){
    const button=el('button',`${step.state==='succeeded'?'✓ ':''}${stepNames[step.kind] || human(step.kind)}`,`stage stage-${step.state}`);
    button.title=`${human(step.state)} · Step ${step.position}`;
    button.onclick=()=>{tabs[1][0].click();const target=[...timeline.querySelectorAll('[data-key]')].find(n=>n.dataset.key===step.id);if(target){target.open=true;target.closest('.run-group').open=true;target.querySelector('summary').focus();target.scrollIntoView({block:'nearest'});}};
    stages.append(button);
  }
  overview.append(stages);
  const facts=el('div',undefined,'work-facts');
  for(const [label,value] of [['Created',date(work.created_at)],['Priority',work.priority>0?'High':work.priority<0?'Later refinement':'Normal']]){
    const item=el('div');item.append(el('span',label,'fact-label'),el('span',value,'fact-value'));facts.append(item);
  }
  const identity=el('details',undefined,'work-identity');identity.append(el('summary',`ID ${work.id.slice(0,8)}`),el('code',work.id),el('p',`Source: ${work.source_key}`));facts.append(identity);
  overview.append(facts);
  const content=el('div',undefined,'work-content');
  const scope=el('details',undefined,'work-scope');scope.dataset.key='scope';scope.open=expanded.get('scope')??work.specification.length<650;
  const scopeTitle=el('summary','Scope and instructions');scope.append(scopeTitle,el('div',work.specification,'spec-box'));content.append(scope);
  const preview=el('p',work.specification.slice(0,240)+(work.specification.length>240?'…':''),'scope-preview');content.append(preview);
  content.append(el('h3','Acceptance criteria'));const criteria=el('ul',undefined,'criteria-list');
  for(const criterion of JSON.parse(work.acceptance_json))criteria.append(el('li',criterion));content.append(criteria);
  overview.append(content);
  const actions=el('div',undefined,'work-detail-actions');
  const reload=el('button','Refresh details','secondary');reload.onclick=async()=>{await refresh();await detail(work);};actions.append(reload);
  if (['active','waiting'].includes(work.status)) { const cancel = el('button','Cancel this run','secondary cancel-work'); cancel.onclick = async () => { if (await act({type:'run.cancel',runId:work.run_id})) await detail(work); }; actions.append(cancel); }
  else { const retry = el('button','Start a new run','secondary'); retry.onclick = async () => { if (await act({type:'work.rerun',workId:work.id})) await detail(work); }; actions.append(retry); }
  body.append(actions);
  for (const run of history.runs) {
  const runBox=el('details',undefined,'run-group');runBox.dataset.key=run.id;runBox.open=expanded.get(run.id)??(run.id===latest.id);runBox.append(el('summary',`Run ${run.revision} · ${human(run.status)}`));timeline.append(runBox);
  for (const step of history.steps.filter(x => x.run_id === run.id).sort((a,b) => a.position-b.position)) {
    const row = el('details',undefined,'detail-step');row.dataset.key=step.id;row.open=expanded.get(step.id)??['running','waiting','retry_scheduled','failed'].includes(step.state);
    const stepHeading=el('summary');stepHeading.append(el('strong',`${step.position}. ${stepNames[step.kind] || human(step.kind)} `),el('span',human(step.state),`badge ${step.state}`));row.append(stepHeading);
    if (step.error) { const details=el('details');details.append(el('summary',step.failure_class ? `${step.failure_class} · failure details` : 'Wait details'),el('pre',step.error));row.append(details); }
    if (step.state === 'retry_scheduled' || (step.state === 'waiting' && step.wait_kind !== 'external')) row.append(el('p',`Next check: ${date(step.next_at)}`));
    const result = step.result_json && JSON.parse(step.result_json);
    if (result?.summary) row.append(el('p',result.summary));

    if (result?.artifact?.path) {
      const artifactBtn = el('button', 'Evidence', 'secondary');
      artifactBtn.onclick = async () => {
        try {
          const data = await api(`evidence?path=${encodeURIComponent(result.artifact.path)}`);
          row.append(el('pre', data.text));
          artifactBtn.disabled = true;
        } catch(e) { error(e); }
      };
      row.append(artifactBtn);
    }

    // Render attempts grouped by generation
    const attempts = history.attempts.filter(x => x.step_id === step.id).sort((a, b) => a.generation - b.generation);
    for (const attempt of attempts) {
      const isRunning = attempt.status === 'running';
      const attBox = el('div', undefined, 'attempt-block');
      const header = el('div', undefined, 'attempt-header');
      const failInfo = attempt.failure_json ? JSON.parse(attempt.failure_json) : null;
      header.append(
        el('span', `Attempt ${attempt.generation}`),
        el('span', isRunning ? 'running' : attempt.status, `badge ${isRunning ? 'running' : attempt.status}`)
      );
      attBox.append(header);

      if (failInfo?.category) {
        const failure=el('details');failure.append(el('summary',`${failInfo.category} · Attempt details`),el('pre',failInfo.message || 'Attempt ended'));attBox.append(failure);
      }

      const attActions = el('div', undefined, 'attempt-actions');
      if (['implement','review','plan','check_plan','resolve'].includes(step.kind)) {
        const logBtn = el('button', isRunning ? 'Worker log (running…)' : 'Worker log', 'secondary');
        if (isRunning) {
          logBtn.disabled = true;
          logBtn.title = 'Worker logs will be available when this attempt finishes.';
        } else {
          logBtn.onclick = async () => {
            try {
              const data = await api(`evidence?path=${encodeURIComponent(`attempts/${attempt.id}/worker.log`)}`);
              attBox.append(el('pre', data.text, 'attempt-log'));
              logBtn.disabled = true;
            } catch(e) { error(e); }
          };
        }
        attActions.append(logBtn);
      }

      if (step.kind === 'verify') {
        const checksButton=el('button','Check results','secondary');checksButton.disabled=isRunning;
        checksButton.onclick=async()=>{
          try {
            const data=await api(`evidence?path=${encodeURIComponent(`attempts/${attempt.id}/verification.json`)}`);
            const proof=JSON.parse(data.text), checks=el('div');
            for(const record of proof.records || []){
              const entry=el('p',`${record.name} · ${record.exit===0?'Passed':`Exit ${record.exit}`} `);
              const log=el('button','Open log','secondary');
              log.onclick=async()=>{try{const result=await api(`evidence?path=${encodeURIComponent(record.log)}`);entry.append(el('pre',result.text,'attempt-log'));log.disabled=true;}catch(e){error(e);}};
              entry.append(log);checks.append(entry);
            }
            attBox.append(checks);checksButton.disabled=true;
          }catch(e){error(new Error(`Check report is unavailable. This attempt may have stopped before it wrote a report. ${e.message}`));}
        };
        attActions.append(checksButton);
      }
      attBox.append(attActions);
      row.append(attBox);
    }
    runBox.append(row);
  }}
  if(!dialog.open)dialog.showModal();
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
  const visible=state.work.filter(w=>($('filter').value==='all'||($('filter').value==='open'?['active','waiting'].includes(w.status):['queued','retry_scheduled','running'].includes($('filter').value)?w.status==='active'&&currentStep(w)?.state===$('filter').value:w.status===$('filter').value))&&`${w.id} ${w.title} ${w.specification}`.toLowerCase().includes($('search').value.toLowerCase()));
  visible.sort((a,b)=>(['active','waiting'].includes(b.status)-['active','waiting'].includes(a.status)) || b.priority-a.priority || b.created_at-a.created_at);
  $('work-count').textContent=`${visible.length} of ${state.work.length} loaded`;
  $('queue-note').textContent=state.work.length>=200?'Search covers the newest 200 items. Open work appears first within this list.':'Open work appears first, then highest priority. Select an item to see its evidence.';
  if(state.work.length&&!visible.length)empty(list,'No matching work','Change the search or state filter.');
  for (const work of visible) {
    const step=currentStep(work), card=el('div',undefined,'work-card'); card.tabIndex=0; card.setAttribute('role','button'); card.setAttribute('aria-label',`Inspect ${work.title}`);
    const titleCol=el('div');

    // Parse sourceKey: e.g. github:owner/repo:72 or manual:... or baseline:...
    const meta=work.metadata_json ? JSON.parse(work.metadata_json) : {};
    const ghIssue = meta.githubIssue || work.source_key?.match(/^github:[^:]+:(\d+)$/)?.[1];
    const ghRepo = state.configuration?.config?.githubRepository;

    // Small supertext above title with short unique identifier
    const supertext = el('div', undefined, 'card-supertext');
    const shortId = work.id.slice(0, 8);
    supertext.append(el('code', shortId));
    if (ghIssue && ghRepo) {
      const ghLink = el('a', `GitHub #${ghIssue}`, 'gh-link');
      ghLink.href = `https://github.com/${ghRepo}/issues/${ghIssue}`;
      ghLink.target = '_blank';
      ghLink.rel = 'noreferrer';
      ghLink.onclick = e => e.stopPropagation();
      supertext.append(ghLink);
    }
    titleCol.append(supertext);

    // Clean title without redundant prefix
    const titleP = el('p', work.title, 'card-title');
    titleCol.append(titleP);

    titleCol.append(el('div',`${work.workflow === 'code'?'Repository work':'Planning'}${work.priority>0?' · High priority':work.priority<0?' · Later refinement':''} · Run ${work.revision} · ${date(work.created_at)}`,'card-meta'));
    const progress=el('div'); progress.append(el('div',step?.kind.replaceAll('_',' ') || 'Queued','step-label'));
    const unmet=state.dependencies.filter(d=>d.work_id===work.id).filter(d=>state.work.find(w=>w.id===d.requires_id)?.status!=='succeeded');
    progress.append(el('div',unmet.length ? `${unmet.length} dependencies pending` : step?.state === 'retry_scheduled' ? `Retry ${date(step.next_at)}` : step?.wait_kind ? `Waiting: ${step.wait_kind}` : (step?.error ? step.error.split('\n')[0].slice(0,120) : `${step?.attempt_count || 0} attempts`),'card-meta'));
    card.append(titleCol,progress,el('span',human(work.status==='active' ? step?.state || 'queued' : work.status),`badge ${work.status==='active' ? step?.state : work.status}`));
    card.onclick=()=>detail(work); card.onkeydown=e=>{if(e.target===card && (e.key==='Enter'||e.key===' ')){e.preventDefault();detail(work);}}; list.append(card);
  }
  const autos=$('automation-list'); autos.replaceChildren();
  if (!state.automations.length) empty(autos,'No scheduled work yet','Add a trigger with a scope, workflow, and acceptance criteria.');
  for (const a of state.automations) {
    const card=el('div',undefined,'automation-card'), info=el('div');
    const def=JSON.parse(a.definition_json);
    const triggerDesc = def.watchHead ? 'New commits on the base branch' : a.trigger_kind === 'github' ? `GitHub issues${def.filterBlocked !== false ? ' (unblocked only)' : ''}` : a.trigger_kind === 'interval' ? 'Scheduled work' : 'Repository files';
    info.append(el('p',a.name,'card-title'),el('div',`${triggerDesc} · Every ${a.interval_ms>=3600000 ? `${+(a.interval_ms/3600000).toFixed(1)} hours` : `${+(a.interval_ms/60000).toFixed(1)} minutes`} · ${a.enabled ? `Next ${date(a.next_at)}`:'Paused'}`,'card-meta'));
    info.append(el('p',`${def.work.workflow==='plan'?'Inspect and plan':'Implement and verify'}: ${def.work.title}`,'help'));
    if(a.last_error) {const failure=el('details');failure.append(el('summary','Last check failed · details'),el('pre',a.last_error));info.append(failure);}
    const button=el('button',a.enabled?'Pause':'Enable','secondary');
    button.onclick=()=>act({type:'automation.enable',id:a.id,enabled:!a.enabled});
    const actions=el('div',undefined,'actions');
    const edit=el('button','Edit','secondary');
    edit.onclick=()=>forms.openAutomation(a);
    const scan=el('button','Check source now','secondary');
    scan.disabled=!a.enabled;
    scan.onclick=()=>act({type:'automation.scan',id:a.id});
    const del=el('button','Delete','secondary');
    del.onclick=async()=>{
      if (confirm(`Are you sure you want to delete automation "${a.name}"?`)) {
        await act({type:'automation.delete',id:a.id});
      }
    };
    actions.append(edit,scan,button,del);
    card.append(info,actions);
    autos.append(card);
  }
  const needs=$('decision-list');
  const nextSignature=JSON.stringify(decisions);
  if(nextSignature!==decisionSignature){decisionSignature=nextSignature;
  const drafts=new Map([...needs.querySelectorAll('form')].map(f=>[f.dataset.id,f.querySelector('textarea').value]));needs.replaceChildren();
  if (!decisions.length) empty(needs,'No external input needed','Routine choices stay with the automation.');
  for (const d of decisions) { const need=JSON.parse(d.body_json), card=el('form',undefined,'decision-card');card.append(el('p',need.question,'card-title'),el('p',need.reason),el('p',`Automation tried: ${need.attempted.join('; ')}`),el('p',`Why no default works: ${need.noSafeDefault}`)); const label=el('label','Required answer'), answer=el('textarea');const related=state.work.find(w=>w.run_id===d.run_id);if(related){const link=el('button',`View work: ${related.title}`,'secondary');link.type='button';link.onclick=()=>detail(related);card.append(link);}card.dataset.id=d.id;answer.value=drafts.get(d.id)||'';answer.required=true;label.append(answer);card.append(label,el('button','Apply answer and continue'));card.onsubmit=async e=>{e.preventDefault();await act({type:'decision.answer',id:d.id,answer:answer.value});};needs.append(card); }
  }
  const events=$('activity-list');const expandedEvents=new Set([...events.querySelectorAll('details[open]')].map(n=>n.dataset.event));events.replaceChildren();
  if (!state.events.length) empty(events,'No events yet','Accepted commands and state transitions will appear here.');
  for(const event of state.events) { const row=el('div',undefined,'event'), content=el('div');content.append(el('strong',event.type.replaceAll('.',' · ')));const data=JSON.parse(event.data_json);const related=state.work.find(w=>w.id===event.entity||w.run_id===event.entity);if(related)content.append(el('p',related.title));if(data.summary||data.message)content.append(el('p',String(data.summary||data.message).split('\n')[0]));const more=el('details');more.dataset.event=String(event.id);more.open=expandedEvents.has(String(event.id));more.append(el('summary','Event details'),el('pre',JSON.stringify(data,null,2)));content.append(more);row.append(el('time',date(event.at)),content);events.append(row); }
  if(!$('settings-view').hidden)forms.loadSettings();
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
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===button));document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==`${button.dataset.tab}-view`);$('stats').hidden=button.dataset.tab!=='work';document.querySelector('.intro h1').textContent={work:'Work queue',automations:'Automations',decisions:'External input',activity:'Activity',settings:'Settings',system:'System health'}[button.dataset.tab];document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-current',b===button?'page':'false'));if(button.dataset.tab==='settings')forms.loadSettings();if(button.dataset.tab==='system')forms.system();$('feedback').textContent='';});
$('create-form').onsubmit=async e=>{e.preventDefault();const ok=await act({type:'work.create',work:{title:$('title').value,specification:$('specification').value,acceptance:$('acceptance').value.split('\n').map(x=>x.trim()).filter(Boolean),workflow:$('workflow').value,priority:Number($('priority').value),dependencies:[...$('dependencies').selectedOptions].map(x=>x.value)}});if(ok){$('create-dialog').close();e.target.reset();}};
const forms=setupForms({$,el,api,act,error,getState:()=>state});
$('search').oninput=render;$('filter').onchange=render;
refresh();setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))refresh();},3000);
