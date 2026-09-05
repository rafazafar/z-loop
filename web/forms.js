// Form state stays local while the live queue refreshes.
export function setupForms({ $, el, api, act, error, getState }) {
  let automationId, settingsRevision, draft;
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
    const name=field(form,'Name',value.name), trigger=select(form,'Source',[['interval','Schedule'],['files','Repository files'],['github','GitHub issues']],value.trigger);
    const interval=field(form,'Check every (minutes)',value.intervalMs/60000,'number');interval.min='0.01';interval.step='any';
    const path=field(form,'Folder in repository',value.path||'.'), label=field(form,'Ready label',value.label||'loop:ready');
    const update=()=>{path.parentElement.hidden=trigger.value!=='files';label.parentElement.hidden=trigger.value!=='github';};trigger.onchange=update;update();
    const enabled=select(form,'Status',[['true','Enabled'],['false','Paused']],String(row?!!row.enabled:value.enabled));
    form.append(el('h3','Work to create'));
    const title=field(form,'Outcome',value.work.title), scope=field(form,'Scope and instructions',value.work.specification,'textarea'), acceptance=field(form,'Acceptance criteria · one per line',value.work.acceptance.join('\n'),'textarea');
    const workflow=select(form,'Workflow',[['plan','Inspect and plan work'],['code','Implement and verify']],value.work.workflow||'code');
    $('automation-form').onsubmit=async e=>{e.preventDefault();const work={...value.work,title:title.value,specification:scope.value,acceptance:acceptance.value.split('\n').map(x=>x.trim()).filter(Boolean),workflow:workflow.value};
      if(await act({type:'automation.save',automation:{id:automationId,name:name.value,trigger:trigger.value,enabled:enabled.value==='true',intervalMs:Math.round(Number(interval.value)*60000),path:path.value,label:label.value,work}}))$('automation-dialog').close();};
    $('automation-dialog').showModal();
  }
  $('add-automation').onclick=()=>openAutomation();
  function loadSettings() {
    const saved=getState().configuration;draft=structuredClone(saved.pending||saved.config);settingsRevision=saved.revision;
    const form=$('settings-fields');form.replaceChildren();
    $('settings-note').textContent=saved.pending?'A saved change is waiting for active attempts to finish. Cancel it to edit again.':`Revision ${saved.revision}. Changes take effect after active attempts finish.`;
    const repo=field(form,'Repository',draft.repository);repo.readOnly=true;
    const mode=select(form,'Integration',[['local','Local branch'],['github','GitHub pull request']],draft.integration);
    const branch=field(form,'Base branch',draft.baseBranch), remote=field(form,'GitHub repository (owner/repository)',draft.githubRepository||'','text',false);
    form.append(el('h3','Worker'));
    const kind=select(form,'Worker',[['opencode','OpenCode'],['command','Custom command']],draft.worker.kind);
    const model=field(form,'Model (blank uses the installed worker default)',draft.worker.model||'','text',false), variant=field(form,'Variant',draft.worker.variant||'','text',false);
    const custom=field(form,'Worker command',commandText(draft.worker.command),'text',false);
    const workerView=()=>{custom.parentElement.hidden=kind.value!=='command';model.parentElement.hidden=variant.parentElement.hidden=kind.value!=='opencode';};kind.onchange=workerView;workerView();
    form.append(el('h3','Required checks'),el('p','Each command runs without shell expansion. Every check must pass before integration.','help'));
    const checks=el('div');form.append(checks);const rows=[];
    const addCheck=(check={name:'',command:[],cwd:'.',timeoutMs:300000})=>{
      const box=el('div',undefined,'check-editor'), row={box};
      row.name=field(box,'Check name',check.name);row.command=field(box,'Command',commandText(check.command));
      row.cwd=field(box,'Working folder',check.cwd);row.timeout=field(box,'Timeout (seconds)',check.timeoutMs/1000,'number');row.timeout.min='1';
      const remove=el('button','Remove check','secondary');remove.type='button';remove.onclick=()=>{box.remove();rows.splice(rows.indexOf(row),1);};box.append(remove);rows.push(row);checks.append(box);
    };
    draft.checks.forEach(addCheck);const add=el('button','＋ Add check','secondary');add.type='button';add.onclick=()=>addCheck();form.append(add);
    form.append(el('h3','Capacity and recovery'));
    const limits={};
    const labels={concurrency:'Concurrent attempts',dailyAttempts:'Model attempts per rolling 24 hours',maxAttempts:'Attempts per failed step',maxRepairs:'Repair rounds per run',attemptMs:'Attempt timeout (milliseconds)',retryBaseMs:'Retry delay (milliseconds)',leaseMs:'Ownership lease (milliseconds)',maxOutputBytes:'Log limit (bytes)'};
    const group=el('div',undefined,'field-grid');form.append(group);for(const [key,label] of Object.entries(labels))limits[key]=field(group,label,draft.limits[key],'number');
    $('settings-form').onsubmit=async e=>{e.preventDefault();try{
      draft.baseBranch=branch.value;draft.integration=mode.value;draft.githubRepository=remote.value||undefined;
      draft.worker=kind.value==='command'?{kind:'command',command:argv(custom.value)}:{kind:'opencode',...(model.value?{model:model.value}:{}),...(variant.value?{variant:variant.value}:{})};
      draft.checks=rows.map(r=>({name:r.name.value,command:argv(r.command.value),cwd:r.cwd.value,timeoutMs:Number(r.timeout.value)*1000}));
      for(const [key,input] of Object.entries(limits))draft.limits[key]=Number(input.value);
      if(await act({type:'configuration.save',config:draft,revision:settingsRevision})){loadSettings();$('settings-note').textContent='Saved. The runtime will apply this change when active attempts finish.';}
    }catch(e){error(e);}};
    $('save-settings').disabled=!!saved.pending;$('cancel-settings').hidden=!saved.pending;
  }
  $('reload-settings').onclick=loadSettings;
  $('cancel-settings').onclick=async()=>{if(await act({type:'configuration.cancel'}))loadSettings();};
  async function system() {
    try {
      const data=await api('system'), box=$('system-details');box.replaceChildren();
      for(const [label,value] of [['State store',data.database],['Free disk space',`${(data.freeBytes/1e9).toFixed(1)} GB`],['Required checks',data.checks],['Active attempts',data.running],['Saved work items',data.counts.work],['Recorded events',data.counts.events],['Backup',data.maintenance?'In progress':'Ready when paused and drained']]){const row=el('div',undefined,'system-row');row.append(el('span',label),el('strong',String(value)));box.append(row);}
      $('backup-list').replaceChildren(...(data.backups.length?data.backups.map(x=>el('li',x)):[el('li','No backups yet.')]));
      $('backup').disabled=!getState().paused||data.running>0||data.maintenance;
    }catch(e){error(e);}
  }
  $('refresh-system').onclick=system;
  $('integrity').onclick=async()=>{try{const data=await api('command',{type:'system.integrity'});$('system-result').textContent=data.results.map(x=>x.integrity_check).join('\n');}catch(e){error(e);}};
  $('backup').onclick=async()=>{const button=$('backup');button.disabled=true;$('system-result').textContent='Creating backup…';try{const data=await api('command',{type:'system.backup'});$('system-result').textContent=`Backup saved: ${data.path}`;await system();}catch(e){error(e);button.disabled=false;}};
  return {openAutomation,loadSettings,system};
}
