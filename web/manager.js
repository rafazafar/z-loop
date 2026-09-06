const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const fragment=new URLSearchParams(location.hash.slice(1));
let token=fragment.get('token')||sessionStorage.getItem('loop-token')||'';
if(fragment.has('token')){sessionStorage.setItem('loop-token',token);history.replaceState(null,'',location.pathname);}
let state,view='overview',offset=0,refreshing=false,capacityDirty=false;
const lastGood=new Map(),pending=new Map();
const date=value=>value?new Date(value).toLocaleString():'Never';
const human=value=>String(value||'Queued').replaceAll('_',' ');
function error(e){$('error').hidden=false;$('error').textContent=e.message;}
async function api(path,body){const response=await fetch(`/api/manager/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok||data.unknown){if(response.status===401){$('login').hidden=false;$('workspace').hidden=true;}const error=Error(data.error||'Request failed');error.confirmedFailure=!data.unknown&&response.status<500;throw error;}return data;}
async function command(body){const sig=JSON.stringify(body);if(!pending.has(sig))pending.set(sig,crypto.randomUUID());try{const data=await api('command',{...body,operationKey:pending.get(sig)});pending.delete(sig);return data;}catch(e){if(e.confirmedFailure)pending.delete(sig);throw e;}}
async function act(body){try{$('error').hidden=true;await command(body);$('feedback').textContent='Change confirmed.';await refresh();return true;}catch(e){error(e);return false;}}
function link(id,text,work,query){const a=el('a',text,'work-link');a.href=`/r/${id}/${work?`?work=${encodeURIComponent(work)}`:query?`?${query}`:''}`;return a;}
function button(text,fn){const b=el('button',text,'secondary');b.onclick=async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}};return b;}
function empty(target,text){if(!target.children.length)target.append(el('p',text,'empty'));}
function selected(){return state.projects.filter(p=>!$('scope').value||p.id===$('scope').value);}
function repoCommand(p,command){return act({type:'repository.command',id:p.id,command});}
function show(){document.querySelectorAll('.manager-view').forEach(n=>n.hidden=n.id!==view);document.querySelectorAll('[data-view]').forEach(n=>{n.classList.toggle('selected',n.dataset.view===view);n.setAttribute('aria-current',n.dataset.view===view?'page':'false');});if(view==='queue')loadQueue();}
function render(){
  const selectedId=$('scope').value;$('scope').replaceChildren(new Option('All repositories',''),...state.projects.map(p=>new Option(p.name,p.id)));$('scope').value=selectedId;
  const running=state.projects.reduce((n,p)=>n+(p.state?.operational?.running||0),0),questions=state.projects.reduce((n,p)=>n+(p.state?.operational?.decisions||0),0),offline=state.projects.filter(p=>!p.healthy).length;
  $('stats').replaceChildren(...[['Repositories',state.projects.length],['Running now',running],['External questions',questions],['Service problems',offline]].map(([label,value])=>{const n=el('div',undefined,'stat');n.append(el('span',label,'stat-label'),el('strong',String(value),'stat-value'));return n;}));
  $('repositories').replaceChildren();$('attention-list').replaceChildren();$('capacity-list').replaceChildren();
  for(const p of selected().sort((a,b)=>Number(!b.healthy||b.state?.operational?.decisions||b.state?.operational?.failed)-Number(!a.healthy||a.state?.operational?.decisions||a.state?.operational?.failed))){
    if(p.state)lastGood.set(p.id,{state:p.state,at:p.checkedAt});
    const saved=lastGood.get(p.id),s=p.state||saved?.state,o=s?.operational,c=s?.configuration?.config;
    const row=el('div',undefined,'repo-row'),identity=el('div');identity.append(el('h3',p.name),el('p',p.repository),el('span',p.mode==='managed'?'Managed here':'External service','badge'));
    const health=el('div');health.append(el('strong',!p.state?'Offline':!p.healthy?'Needs attention':s.manager?.reason?'Dispatch waiting':s.paused?'Paused':'Connected'),el('p',s?.manager?.reason||''),el('p',p.state?`Checked ${date(p.checkedAt)}`:saved?`Last data ${date(saved.at)}`:'No status received'));
    const counts=el('div');counts.append(el('p',o?`${o.running} running · ${o.queued} queued · ${o.waiting} waiting`:'Counts unavailable'),el('p',o?`${o.failed} failed · ${o.decisions} questions`:''),el('p',c?`${s.budgetUsed} / ${c.limits.dailyAttempts} model attempts`:''));
    const actions=el('div',undefined,'actions');actions.append(link(p.id,'Open repository'));
    if(p.state)actions.append(button(s.paused?'Resume':'Pause',()=>repoCommand(p,{type:s.paused?'controller.resume':'controller.pause'})));
    if(!p.state)actions.append(button(p.mode==='external'?'Transfer control':'Retry start',()=>act({type:'repository.manage',id:p.id})));
    row.append(identity,health,counts,actions);$('repositories').append(row);
    const alert=(title,description,work,destination)=>{const box=el('div',undefined,'alert-card');box.append(el('h3',`${p.name} · ${title}`),el('p',description),link(p.id,'Inspect repository',work));if(destination)box.querySelector('a').href=`/r/${p.id}/?${destination}`;$('attention-list').append(box);};
    if(p.error||!p.healthy)alert('Service needs attention',p.error||'Controller health check failed.');
    for(const d of s?.decisions||[])if(d.status==='needs_external'){const body=JSON.parse(d.body_json);alert('External input required',`${body.question||body.need?.question||'Open External input to answer.'} · Since ${date(d.created_at)}`,undefined,'view=decisions');}
    if(o?.failed)alert(`${o.failed} stopped work items`,'Open stopped work and inspect its evidence.',undefined,'status=failed');
    for(const a of s?.automations||[])if(a.last_error)alert(`Source: ${a.name}`,a.last_error);
    for(const provider of s?.providers||[])alert('Provider retry pending',`${provider.reason} · Retry after ${date(provider.until_at)}`);
    const capacity=el('div',undefined,'alert-card');capacity.append(el('h3',p.name),el('p',c?`${o?.running??'?'} / ${c.limits.concurrency} active attempts · ${s.budgetUsed} / ${c.limits.dailyAttempts} model attempts in 24 hours`:'Capacity unavailable'),el('p',p.mode==='external'?'Independent service. Shared limits do not apply.':state.settings.paused?'Shared dispatch is paused.':state.usage.running>=state.settings.concurrency?'Waiting for shared capacity.':state.usage.used>=state.settings.dailyAttempts?`Model budget reached. Earliest release: ${date(state.usage.nextBudgetAt)}`:s?.paused?'Repository dispatch is paused.':'Shared capacity is available; repository checks and limits also apply.'),link(p.id,'Repository settings',undefined,'view=settings'));$('capacity-list').append(capacity);
  }
  empty($('repositories'),'Add your first repository. Connect an existing workspace without restarting it.');empty($('attention-list'),'No recorded problems or external questions in this selection.');
  if(!capacityDirty){$('concurrency').value=state.settings.concurrency;$('daily').value=state.settings.dailyAttempts;}
  $('capacity-note').textContent=`${state.usage.running} / ${state.settings.concurrency} shared active attempts · ${state.usage.used} / ${state.settings.dailyAttempts} model attempts. Lower limits take effect as active work finishes.`;
  $('pause-managed').textContent=state.settings.paused?'Resume managed dispatch':'Pause managed dispatch';
  $('operation-list').replaceChildren();for(const op of state.operations){const input=JSON.parse(op.input_json),result=op.result_json?JSON.parse(op.result_json):null;const p=state.projects.find(p=>p.id===input.id);const box=el('details',undefined,'alert-card');box.append(el('summary',`${p?.name||'Manager'} · ${input.command?.type||input.type} · ${['pending','prepared'].includes(op.status)?'Unknown / pending':op.status}`),el('p',`Operation ${op.key}`));if(result)box.append(el('pre',JSON.stringify(result.data,null,2)));if(['pending','prepared'].includes(op.status))box.append(button('Reconcile same request',async()=>{try{const r=await api('command',{...input,operationKey:op.key});$('feedback').textContent='Request reconciled.';await refresh();}catch(e){error(e);}}));$('operation-list').append(box);}
  empty($('operation-list'),'No control requests yet.');$('updated').textContent=`Updated ${date(Date.now())}`;
  if(state.error)error(Error(state.error));
}
async function refresh(){if(refreshing)return;if(!token){$('login').hidden=false;return;}refreshing=true;try{state=await api('state');$('login').hidden=true;$('workspace').hidden=false;$('connection').textContent='Connected';render();if(view==='queue')await loadQueue();}catch(e){$('connection').textContent='Disconnected';error(e);}finally{refreshing=false;}}
let queueRequest=0;
async function loadQueue(){const request=++queueRequest;try{const data=await api(`work?search=${encodeURIComponent($('search').value)}&status=${$('status').value}&offset=${offset}&repository=${$('scope').value}`);if(request!==queueRequest)return;$('work-list').replaceChildren();for(const w of data.work){const a=link(w.repositoryId,'',w.id);a.className='work-card';a.append(el('strong',w.title),el('div',`${w.repositoryName} · ${human(w.step_state||w.status)} · ${human(w.step_kind)} · ${date(w.created_at)}`,'card-meta'));if(w.error)a.append(el('p',w.error,'help'));$('work-list').append(a);}empty($('work-list'),'No work matches these filters.');$('queue-summary').textContent=`${data.total?offset+1:0}–${Math.min(offset+50,data.total)} of ${data.total} items. Search covers all stored work.${data.errors.length?' Some repositories could not be read.':''}`;$('previous').disabled=!offset;$('next').disabled=offset+50>=data.total;for(const e of data.errors)error(Error(e.error));}catch(e){error(e);}}
$('login').onsubmit=e=>{e.preventDefault();token=$('token').value.trim();sessionStorage.setItem('loop-token',token);refresh();};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;show();});$('scope').onchange=()=>{offset=0;render();show();};
let searchTimer;const search=()=>{offset=0;clearTimeout(searchTimer);searchTimer=setTimeout(loadQueue,180);};$('search').oninput=search;$('status').onchange=search;$('previous').onclick=()=>{offset=Math.max(0,offset-50);loadQueue();};$('next').onclick=()=>{offset+=50;loadQueue();};
$('capacity-form').oninput=()=>capacityDirty=true;$('capacity-form').onsubmit=async e=>{e.preventDefault();if(await act({type:'capacity.save',concurrency:Number($('concurrency').value),dailyAttempts:Number($('daily').value)})){capacityDirty=false;render();}};
$('pause-managed').onclick=()=>act({type:'manager.pause',paused:!state.settings.paused});
let groupBusy=false;
async function all(paused){if(groupBusy)return;groupBusy=true;$('pause-all').disabled=$('resume-all').disabled=true;const results=[];await act({type:'manager.pause',paused});for(const p of state.projects){try{await command({type:'repository.command',id:p.id,command:{type:paused?'controller.pause':'controller.resume'}});results.push(`${p.name}: confirmed`);}catch(e){results.push(`${p.name}: ${e.message}`);}}$('feedback').textContent=results.join(' · ');await refresh();groupBusy=false;$('pause-all').disabled=$('resume-all').disabled=false;}
$('pause-all').onclick=()=>all(true);$('resume-all').onclick=()=>all(false);
let step=0,config,setupBusy=false,setupKey,checkRows=[];
function addCheck(check={name:'',command:[],cwd:'.',timeoutMs:300000}){
  const box=el('details',undefined,'check-editor'),summary=el('summary',check.name||'New check');box.open=!check.name;box.append(summary);
  const field=(label,value,type='text')=>{const row=el('label',label),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value;row.append(input);box.append(row);return input;};
  const name=field('Check name',check.name),command=field('Executable',check.command[0]||''),args=field('Arguments · one per line',check.command.slice(1).join('\n'),'textarea'),cwd=field('Working folder',check.cwd),timeout=field('Timeout (seconds)',check.timeoutMs/1000,'number');timeout.min='1';
  const label=el('label','Purpose'),purpose=el('select');purpose.append(new Option('Verification','verify'),new Option('Dependency setup','setup'));purpose.value=check.setup?'setup':'verify';label.append(purpose);box.append(label);
  const row={box,name,command,args,cwd,timeout,purpose,original:check};checkRows.push(row);
  name.oninput=()=>summary.textContent=name.value||'New check';
  const remove=button('Remove check',()=>{box.remove();checkRows=checkRows.filter(r=>r!==row);});remove.type='button';box.append(remove);$('checks').append(box);
}
$('add-check').onclick=()=>addCheck();
function setupShow(){document.querySelectorAll('[data-step]').forEach(n=>{n.hidden=Number(n.dataset.step)!==step;for(const field of n.querySelectorAll('input,select,textarea'))field.disabled=n.hidden;});document.querySelectorAll('.setup-progress li').forEach((n,i)=>{if(i===step)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');});$('back').hidden=step===0;$('continue').textContent=step===2?'Add repository':step===1?'Review setup':$('mode').value==='existing'?'Review connection':'Inspect repository';}
$('mode').onchange=()=>{$('path-label').textContent=$('mode').value==='existing'?'Existing state directory':'Git repository folder';$('path-note').textContent=$('mode').value==='existing'?'Connect without restarting the service or changing its settings. Shared limits do not apply until you transfer control.':'Setup reads repository files. It does not run checks or start model work.';setupShow();};
$('add').onclick=()=>{step=0;config=null;setupKey=null;$('setup-form').reset();$('setup-error').hidden=true;$('mode').onchange();$('setup').showModal();};$('close-setup').onclick=()=>{if(!setupBusy)$('setup').close();};$('setup').addEventListener('cancel',e=>{if(setupBusy)e.preventDefault();});$('back').onclick=()=>{step=$('mode').value==='existing'?0:step-1;setupShow();};
$('setup-form').onsubmit=async e=>{e.preventDefault();if(setupBusy)return;setupBusy=true;$('continue').disabled=true;$('back').disabled=true;$('setup-error').hidden=true;try{
  const existing=$('mode').value==='existing';
  if(step===0&&!existing){config=await api('inspect',{repository:$('path').value});checkRows=[];$('checks').replaceChildren(el('p',`Branch: ${config.baseBranch}`));config.checks.forEach(addCheck);if(!config.checks.some(c=>!c.setup))$('checks').append(el('p','No verification checks detected. Add checks below, or begin with planning work.'));step=1;}
  else if(step<2){if(!existing){config.checks=checkRows.map(r=>({...r.original,name:r.name.value.trim(),command:[r.command.value.trim(),...r.args.value.split('\n').filter(Boolean)],cwd:r.cwd.value.trim(),timeoutMs:Number(r.timeout.value)*1000,setup:r.purpose.value==='setup'}));if(config.checks.some(c=>!c.name||!c.command[0]||!c.cwd))throw Error('Each check needs a name, executable, and working folder.');}step=2;$('review').replaceChildren();for(const [key,value]of [['Name',$('name').value],['Connection',existing?'Existing service':'Managed here'],['Folder',existing?$('path').value:config.repository],...existing?[]:[['Branch',config.baseBranch],['Model',$('model').value||'Installed default'],['Checks',config.checks.length],['Daily attempts',$('budget').value]]])$('review').append(el('dt',key),el('dd',String(value)));$('review-note').textContent=existing?'The manager reads this workspace and sends controls only when you select them. The current service stays running.':'The new queue starts empty. Repository integration stays local. No model work starts during setup.';}
  else {const input=existing?{type:'repository.attach',name:$('name').value,home:$('path').value}:{type:'repository.create',name:$('name').value,repository:config.repository,checks:config.checks,model:$('model').value,dailyAttempts:Number($('budget').value)};const signature=JSON.stringify(input);if(setupKey?.signature!==signature)setupKey={signature,key:crypto.randomUUID()};await api('command',{...input,operationKey:setupKey.key});$('setup').close();await refresh();}
  setupShow();
}catch(e){if(e.confirmedFailure)setupKey=null;$('setup-error').hidden=false;$('setup-error').textContent=e.message;}finally{setupBusy=false;$('continue').disabled=false;$('back').disabled=false;}};
refresh();setInterval(()=>{if(!document.hidden&&!$('setup').open)refresh();},3000);
