// Form state stays local while the live queue refreshes.
export function setupForms({ $, el, api, act, error, getState }) {
  let automationId, settingsRevision, draft, dirty=false;
  const section=(parent,title,description,open=false)=>{
    const box=el('details',undefined,'settings-section');box.open=open;
    box.append(el('summary',title),el('p',description,'help'));parent.append(box);return box;
  };
  const markDirty=()=>{dirty=true;$('settings-note').textContent='Unsaved changes. Save to apply them after active attempts finish.';};
  $('settings-form').addEventListener('input',e=>{if(e.target.type!=='search')markDirty();});
  $('settings-form').addEventListener('invalid',e=>{for(let box=e.target.closest('details');box;box=box.parentElement.closest('details')){box.hidden=false;box.open=true;}},true);
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  const field = (form, label, value, type='text', required=true) => {
    const row=el('label',label), input=el(type==='textarea'?'textarea':'input');
    if(type!=='textarea')input.type=type; input.value=value ?? ''; input.required=required;
    row.append(input); form.append(row); return input;
  };
  const select = (form,label,options,value) => {
    const row=el('label',label), input=el('select');
    for(const [key,text] of options) { const option=el('option',text);option.value=key;input.append(option); }
    input.value=value;row.append(input);form.append(row);return input;
  };
  const argv = text => {
    if(text.trim().startsWith('[')) { const value=JSON.parse(text);if(!Array.isArray(value)||!value.length||value.some(x=>typeof x!=='string'||!x))throw new Error('Use a command and its arguments.');return value; }
    const result=[];let word='',quote='',escape=false,started=false;
    for(const c of text.trim()) {
      if(escape){word+=c;escape=false;started=true;continue;}
      if(c==='\\'&&quote!=="'"){escape=true;continue;}
      if(quote){if(c===quote)quote='';else word+=c;started=true;continue;}
      if(c==='"'||c==="'"){quote=c;started=true;continue;}
      if(/\s/.test(c)){if(started){result.push(word);word='';started=false;}continue;}
      if(/[|;&<>`$]/.test(c))throw new Error('Shell operators are not supported. Use an explicit shell command if required.');
      word+=c;started=true;
    }
    if(quote||escape)throw new Error('Close each quote and escape in the command.');
    if(started)result.push(word);if(!result.length)throw new Error('A command is required.');return result;
  };
  const commandText = values => values?.map(x=>/^[\w./:=@-]+$/.test(x)?x:JSON.stringify(x)).join(' ') || '';
  function openAutomation(row) {
    const value=row?JSON.parse(row.definition_json):{name:'Repository maintenance',trigger:'interval',enabled:true,intervalMs:86400000,work:{title:'Inspect repository maintenance needs',workflow:'plan',specification:'Find one maintenance task with evidence. Return no proposals when no useful work is needed.',acceptance:['Each proposal cites a concrete defect or maintenance need.']}};
    automationId=row?.id;
    $('automation-heading').textContent=row?'Edit automation':'New automation';
    const form=$('automation-fields');form.replaceChildren();
    form.append(el('h3','1. Choose when work starts'));
    const sourceHelp=el('p',undefined,'help');
    const name=field(form,'Name',value.name), trigger=select(form,'Source',[['interval','Schedule'],['head','Repository commits'],['files','Repository files'],['github','GitHub issues']],value.watchHead?'head':value.trigger);
    const interval=field(form,'Check every (minutes)',value.intervalMs/60000,'number');interval.min='0.01';interval.step='any';
    const path=field(form,'Folder in repository',value.path||'.'), label=field(form,'Ready label',value.label||'loop:ready');
    const filterBlocked=select(form,'Blocker check',[['true','Only non-blocked issues (Recommended)'],['false','All issues (ignore blockers)']],String(value.filterBlocked!==false));
    form.append(sourceHelp);
    const update=()=>{sourceHelp.textContent={interval:'Creates work on this schedule. Runs do not overlap.',head:'Checks the base branch. Only a new commit creates work.',files:'Checks this folder for new or changed source files.',github:'Imports open issues with the ready label. Imported sources are not queued twice.'}[trigger.value];path.parentElement.hidden=trigger.value!=='files';label.parentElement.hidden=filterBlocked.parentElement.hidden=trigger.value!=='github';path.disabled=trigger.value!=='files';label.disabled=filterBlocked.disabled=trigger.value!=='github';};trigger.onchange=update;update();
    const enabled=select(form,'Status',[['true','Enabled'],['false','Paused']],String(row?!!row.enabled:value.enabled));
    form.append(el('h3','2. Define the work'),el('p','Use planning to inspect the repository and propose bounded tasks. Use implementation for a known change.','help'));
    const title=field(form,'Outcome',value.work.title), scope=field(form,'Scope and instructions',value.work.specification,'textarea'), acceptance=field(form,'Acceptance criteria · one per line',value.work.acceptance.join('\n'),'textarea');
    const workflow=select(form,'Workflow',[['plan','Inspect and plan work'],['code','Implement and verify']],value.work.workflow||'code');
    $('automation-form').onsubmit=async e=>{e.preventDefault();const work={...value.work,title:title.value,specification:scope.value,acceptance:acceptance.value.split('\n').map(x=>x.trim()).filter(Boolean),workflow:workflow.value};
      if(await act({type:'automation.save',automation:{id:automationId,name:name.value,trigger:trigger.value==='head'?'interval':trigger.value,watchHead:trigger.value==='head',filterBlocked:filterBlocked.value==='true',enabled:enabled.value==='true',intervalMs:Math.round(Number(interval.value)*60000),path:path.value,label:label.value,work}}))$('automation-dialog').close();};
    $('automation-dialog').showModal();
  }
  $('add-automation').onclick=()=>openAutomation();
  function loadSettings(force=false) {
    if(draft && !force && (dirty || settingsRevision===getState().configuration.revision))return;
    dirty=false;
    const saved=getState().configuration;draft=structuredClone(saved.pending||saved.config);settingsRevision=saved.revision;
    const form=$('settings-fields');form.replaceChildren();
    $('settings-note').textContent=saved.pending?'A saved change is waiting for active attempts to finish. Cancel it to edit again.':`Revision ${saved.revision}. Changes take effect after active attempts finish.`;
    const capacity=section(form,'Capacity and recovery','Set how much work can run, and how often the loop can retry.',true);
    const limits={}, factors={attemptMs:60000,retryBaseMs:1000,leaseMs:1000,maxOutputBytes:1000000};
    const labels={concurrency:'Concurrent attempts',dailyAttempts:'Model attempts per rolling 24 hours',maxAttempts:'Attempts per failed step',maxRepairs:'Repair rounds per run'};
    const hints={concurrency:'Use 1 to run one attempt at a time.',dailyAttempts:'The loop waits when this budget is used. It resumes as older attempts leave the 24-hour window.',maxAttempts:'Includes the first attempt. Transient failures retry automatically.',maxRepairs:'Maximum cycles to correct work after verification or review fails.'};
    const group=el('div',undefined,'field-grid');capacity.append(group);
    for(const [key,label] of Object.entries(labels)){limits[key]=field(group,label,draft.limits[key],'number');limits[key].min=key==='maxRepairs'?'0':'1';limits[key].parentElement.append(el('small',hints[key]));}
    const worker=section(form,'Worker and model',`${draft.worker.kind === 'opencode' ? 'OpenCode' : 'Custom command'} · ${draft.worker.model || 'Installed default'} · ${draft.worker.variant || 'Default thinking'}`);
    const kind=select(worker,'Worker',[['opencode','OpenCode'],['command','Custom command']],draft.worker.kind);
    const model=field(worker,'Model (blank uses the installed default)',draft.worker.model||'','text',false), variant=field(worker,'Thinking variant (blank uses default)',draft.worker.variant||'','text',false);
    const workerTimeout=field(worker,'Model call timeout (seconds)',(draft.worker.timeoutMs??draft.limits.attemptMs)/1000,'number');workerTimeout.min='1';
    const custom=field(worker,'Worker command',commandText(draft.worker.command),'text',false);
    const workerView=()=>{custom.parentElement.hidden=kind.value!=='command';model.parentElement.hidden=variant.parentElement.hidden=kind.value!=='opencode';};kind.onchange=workerView;workerView();
    const checkSection=section(form,`Required checks (${draft.checks.length})`,'Keep existing checks unless the repository requirements change. Matching checks must pass before integration.');
    const search=field(checkSection,'Find a check','','search',false), checks=el('div');checkSection.append(checks);const rows=[];
    const filterChecks=()=>{for(const r of rows)r.box.hidden=!`${r.name.value} ${r.cwd.value}`.toLowerCase().includes(search.value.toLowerCase());};search.oninput=filterChecks;
    const addCheck=(check={name:'',command:[],cwd:'.',timeoutMs:300000})=>{
      const box=el('details',undefined,'check-editor'), row={box};box.open=!check.name;
      const summary=el('summary',check.name||'New check');box.append(summary);
      row.name=field(box,'Check name',check.name);row.name.addEventListener('input',()=>summary.textContent=row.name.value||'New check');
      row.command=field(box,'Command',commandText(check.command));
      row.paths=field(box,'Changed paths (one pattern per line; blank means all)',(check.paths||[]).join('\n'),'textarea',false);row.setup=select(box,'Purpose',[['false','Verification'],['true','Dependency setup']],String(!!check.setup));
      row.cwd=field(box,'Working folder',check.cwd);row.timeout=field(box,'Timeout (seconds)',check.timeoutMs/1000,'number');row.timeout.min='1';
      const remove=el('button','Remove check','secondary');remove.type='button';remove.onclick=()=>{box.remove();rows.splice(rows.indexOf(row),1);markDirty();};box.append(remove);rows.push(row);checks.append(box);
    };
    draft.checks.forEach(addCheck);const add=el('button','＋ Add check','secondary');add.type='button';add.onclick=()=>{search.value='';filterChecks();addCheck();markDirty();};checkSection.append(add);
    const repository=section(form,'Repository and integration',`${draft.repository} · ${draft.baseBranch}`);
    const repo=field(repository,'Repository',draft.repository);repo.readOnly=true;
    const mode=select(repository,'Integration',[['local','Local branch'],['github','GitHub pull request']],draft.integration);
    const branch=field(repository,'Base branch',draft.baseBranch), remote=field(repository,'GitHub repository (owner/repository)',draft.githubRepository||'','text',false);
    const advanced=section(form,'Advanced timeouts and storage','Keep these values unless a timeout or storage limit needs to change.');
    for(const [key,label] of Object.entries({attemptMs:'Full step timeout (minutes)',retryBaseMs:'Initial retry delay (seconds)',leaseMs:'Ownership lease (seconds)',maxOutputBytes:'Log limit (MB)'})){limits[key]=field(advanced,label,draft.limits[key]/factors[key],'number');limits[key].step='any';limits[key].min='0.001';}
    $('settings-form').onsubmit=async e=>{e.preventDefault();try{
      draft.baseBranch=branch.value;draft.integration=mode.value;draft.githubRepository=remote.value||undefined;
      draft.worker=kind.value==='command'?{kind:'command',command:argv(custom.value)}:{kind:'opencode',...(model.value?{model:model.value}:{}),...(variant.value?{variant:variant.value}:{})};
      draft.worker.timeoutMs=Number(workerTimeout.value)*1000;
      draft.checks=rows.map(r=>({name:r.name.value,command:argv(r.command.value),cwd:r.cwd.value,timeoutMs:Number(r.timeout.value)*1000,paths:r.paths.value.split('\n').map(x=>x.trim()).filter(Boolean),setup:r.setup.value==='true'}));
      for(const [key,input] of Object.entries(limits))draft.limits[key]=Math.round(Number(input.value)*(factors[key]||1));
      if(await act({type:'configuration.save',config:draft,revision:settingsRevision})){loadSettings(true);$('settings-note').textContent='Saved. The runtime will apply this change when active attempts finish.';}
    }catch(e){error(e);}};
    $('save-settings').disabled=!!saved.pending;$('cancel-settings').hidden=!saved.pending;
  }
  $('reload-settings').onclick=()=>loadSettings(true);
  $('cancel-settings').onclick=async()=>{if(await act({type:'configuration.cancel'}))loadSettings(true);};
  async function system() {
    try {
      const data=await api('system'), box=$('system-details');box.replaceChildren();
      for(const [label,value] of [['State store',data.database],['Free disk space',`${(data.freeBytes/1e9).toFixed(1)} GB`],['Required checks',data.checks],['Active attempts',data.running],['Saved work items',data.counts.work],['Recorded events',data.counts.events],['Backup',data.maintenance?'In progress':!getState().paused?'Pause new work first':data.running?'Waiting for active attempts to finish':'Ready to create']]){const row=el('div',undefined,'system-row');row.append(el('span',label),el('strong',String(value)));box.append(row);}
      $('backup-list').replaceChildren(...(data.backups.length?data.backups.map(x=>el('li',x)):[el('li','No backups yet.')]));
      $('backup').disabled=!getState().paused||data.running>0||data.maintenance;
    }catch(e){error(e);}
  }
  $('refresh-system').onclick=system;
  $('integrity').onclick=async()=>{try{const data=await api('command',{type:'system.integrity'});$('system-result').textContent=data.results.map(x=>x.integrity_check).join('\n');}catch(e){error(e);}};
  $('backup').onclick=async()=>{const button=$('backup');button.disabled=true;$('system-result').textContent='Creating backup…';try{const data=await api('command',{type:'system.backup'});$('system-result').textContent=`Backup saved: ${data.path}`;await system();}catch(e){error(e);button.disabled=false;}};
  return {openAutomation,loadSettings,system};
}
