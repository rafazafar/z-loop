const $=id=>document.getElementById(id);
const el=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
const fragment=new URLSearchParams(location.hash.slice(1));
let token=fragment.get('token') || sessionStorage.getItem('loop-token') || '';
if(fragment.has('token')){sessionStorage.setItem('loop-token',token);history.replaceState(null,'',location.pathname);}
let step=0,config,busy=false;
const connect=()=>{$('connect').hidden=!!token;$('wizard').hidden=!token;};connect();
$('connect').onsubmit=e=>{e.preventDefault();token=$('access-token').value.trim();connect();};
const fail=e=>{$('setup-error').hidden=false;$('setup-error').textContent=e.message;};
async function api(action,body){const response=await fetch(`/api/setup/${action}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok){if(response.status===401){token='';connect();}throw Error(data.error);}return data;}
function show(){
  document.querySelectorAll('[data-step]').forEach(n=>{n.hidden=Number(n.dataset.step)!==step;for(const input of n.querySelectorAll('input,textarea'))input.disabled=n.hidden;});
  document.querySelectorAll('.setup-progress li').forEach((n,i)=>{if(i===step)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');});
  $('back').hidden=step===0;$('next').textContent=['Find repository','Review setup','Create workspace'][step];
  if(step===2){const list=$('setup-review');list.replaceChildren();for(const [key,value] of [['Repository',config.repository],['Base branch',config.baseBranch],['Worker',`OpenCode · ${$('model').value.trim()||'Installed default'} · Default thinking`],['Capacity',`1 concurrent attempt · ${$('budget').value} model attempts / 24 hours`],['Checks',`${config.checks.length} configured`],['Integration','Local branch']])list.append(el('dt',key),el('dd',value));}
}
function renderChecks(){const list=$('setup-checks');list.replaceChildren();for(const check of config.checks){const row=el('div','');row.className='setup-check';row.append(el('strong',check.name),el('code',check.command.join(' ')));list.append(row);}$('no-checks').hidden=config.checks.some(c=>!c.setup);}
$('add-check').onclick=()=>{const name=$('check-name').value.trim(),command=$('check-command').value.trim();if(!name||!command||/\s/.test(command)){fail(Error('Enter a check name and one executable. Put each argument on its own line.'));return;}if(config.checks.some(c=>c.name===name)){fail(Error('Use a unique check name.'));return;}config.checks.push({name,command:[command,...$('check-args').value.split('\n').map(s=>s.trim()).filter(Boolean)],cwd:'.',timeoutMs:600000});renderChecks();$('setup-error').hidden=true;};
$('back').onclick=()=>{if(busy)return;step--;show();};
$('setup-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;busy=true;$('next').disabled=$('back').disabled=true;$('setup-error').hidden=true;
  try{
    if(step===0){$('setup-status').textContent='Inspecting repository…';config=await api('inspect',{repository:$('repository').value});renderChecks();step=1;show();}
    else if(step===1){step=2;show();}
    else {
      $('setup-status').textContent='Creating workspace…';
      await api('finish',{repository:config.repository,model:$('model').value,dailyAttempts:Number($('budget').value),checks:config.checks});
      sessionStorage.setItem('loop-token',token);$('setup-status').textContent='Starting the dashboard…';
      for(let i=0;i<60;i++){try{const response=await fetch('/health');if(response.ok){const health=await response.json();if(health.healthy){location.replace('/');return;}}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
      throw Error('Setup was saved. The runtime is taking longer to start. Reload this page or restart npm start.');
    }
    $('setup-status').textContent='';
  }catch(e){fail(e);$('setup-status').textContent='';}
  finally{busy=false;$('next').disabled=$('back').disabled=false;}
};
show();
