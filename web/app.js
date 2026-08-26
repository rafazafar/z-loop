let state;let pending;let refreshTimer;
const $=(selector)=>document.querySelector(selector);
const esc=(value="")=>String(value).replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const title=(id)=>id.split("-").map((word)=>word[0].toUpperCase()+word.slice(1)).join(" ");
const stamp=(loop)=>loop.unavailable?"NOT READY":loop.status.toUpperCase();
const node=(loop)=>`<button class="graph-node n-${loop.id} ${loop.status} ${loop.unavailable?"unavailable":""}" data-inspect="${loop.id}"><strong>${title(loop.id)}</strong><span class="stamp">${esc(stamp(loop))}</span><small>${esc(loop.cadence)} · ${loop.timerLoaded?"armed":"not armed"}</small><small>${esc(loop.work)}</small><small class="mobile-flow">OUTPUT → ${esc(loop.produces)}</small></button>`;
const fact=(label,value)=>`<div class="fact"><span>${label}</span><b>${esc(value)}</b></div>`;

async function load(silent=false){
  try{const response=await fetch("/api/state");if(!response.ok)throw new Error("State unavailable");state=await response.json();render();if(!silent)toast("State refreshed");}
  catch(error){$("#freshness").textContent=`STATE STALE · ${error.message}`;}
}

function render(){
  $("#repo").textContent=state.repo.ghrepo;$("#repoPath").textContent=state.repo.path;
  const active=state.loops.filter((loop)=>loop.status==="active").length;const running=state.sessions.filter((session)=>session.status==="running").length;
  $("#counters").innerHTML=`<div class="counter"><b>${active}</b>ACTIVE</div><div class="counter"><b>${state.frontier.length}</b>READY</div><div class="counter running"><b>${running}</b>RUNNING</div>`;
  $("#freshness").textContent=`read ${new Date(state.generatedAt).toLocaleTimeString()} · ${state.decisions.length} open decisions`;
  const graphOrder=["spec-sync","ticket-factory","decision-desk","implement","gardener"];
  $("#graphNodes").innerHTML=graphOrder.map((id)=>state.loops.find((loop)=>loop.id===id)).filter(Boolean).map(node).join("");
  $("#loopGrid").innerHTML=state.loops.map((loop)=>`<article class="loop-card ${esc(loop.status)} ${loop.unavailable?"unavailable":""}"><div class="card-top"><h3>${title(loop.id)}</h3><span class="badge">${esc(stamp(loop))}</span></div><div class="facts">${fact("TRIGGER",loop.cadence)}${fact("TIMER",loop.timerLoaded?"Armed":"Not loaded")}${fact("CURRENT WORK",loop.work)}${fact("LAST EVENT",loop.timeline[0]||"Never")}</div><div class="actions"><button class="primary" data-action="run" data-loop="${loop.id}" ${!loop.triggerable?"disabled":""}>Run now</button><button data-action="toggle" data-loop="${loop.id}">${loop.status==="active"?"Pause":"Resume"}</button><button data-inspect="${loop.id}">Inspect</button></div>${loop.unavailable?`<p class="reason">${esc(loop.unavailable)}</p>`:""}</article>`).join("");
  const aliases=Object.entries(state.routing.aliases).map(([name,route])=>`<div class="route-row"><span>${esc(name)}</span><span>${esc(route.model)} · ${esc(route.variant)}</span></div>`).join("");
  const roles=Object.entries(state.routing.roles).map(([name,role])=>`<div class="route-row"><span>${esc(name)}</span><span>${esc(role.model)}</span></div>`).join("");
  $("#routing").innerHTML=`<div class="route-table"><h3>Model aliases</h3>${aliases}</div><div class="route-table"><h3>Role assignments</h3>${roles}</div>`;
}

function inspect(id){
  const loop=state.loops.find((item)=>item.id===id);const sessions=state.sessions.filter((item)=>item.loop===id);const logs=state.logs.filter((log)=>sessions.some((session)=>session.log===log.name));
  $("#drawerBody").innerHTML=`<span class="eyebrow">LOOP DETAIL · domains/${id}/README.md</span><h2>${title(id)}</h2><span class="badge">${esc(stamp(loop))}</span><p class="goal">${esc(loop.goal)}</p><div class="flow"><div><span>CONSUMES</span>${esc(loop.consumes)}</div><div><span>PRODUCES</span>${esc(loop.produces)}</div></div><section class="drawer-section"><h3>Recent timeline</h3>${loop.timeline.map((line)=>`<div class="ticket">${esc(line)}</div>`).join("")||"<p>No runs recorded.</p>"}</section><section class="drawer-section"><h3>Sessions</h3>${sessions.map((session)=>`<details class="session"><summary>${esc(session.id)} · ${esc(session.status)}</summary><p>${esc(session.route)}</p><pre>${esc(session.result||"No result written.")}</pre></details>`).join("")||"<p>No sessions for this loop.</p>"}</section><section class="drawer-section"><h3>Logs</h3>${logs.map((log)=>`<button class="log-link" data-log="${esc(log.name)}">${esc(log.name)} · ${formatBytes(log.size)}</button>`).join("")||"<p>No logs for this loop.</p>"}</section>`;
  $("#drawer").classList.add("open");$("#scrim").classList.add("open");$("#drawer").setAttribute("aria-hidden","false");
}

function closeDrawer(){$("#drawer").classList.remove("open");$("#scrim").classList.remove("open");$("#drawer").setAttribute("aria-hidden","true")}
function ask(action,loop){pending={action,loop};const item=state.loops.find((entry)=>entry.id===loop);$("#confirmTitle").textContent=`${action==="run"?"Run":"Change"} ${title(loop)}`;$("#confirmText").textContent=action==="run"?`Start one ${item.cadence.toLowerCase()} check now. This command is safe to re-run.`:`${item.status==="active"?"Pause":"Resume"} this loop. Running sessions are not stopped.`;$("#confirm").showModal()}
async function act(){try{const response=await fetch("/api/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(pending)});const result=await response.json();toast(!response.ok||result.ok===false?`FAILED · ${result.output||result.error}`:result.output||"Action complete");await load(true)}catch(error){toast(`FAILED · ${error.message}`)}}
async function openLog(name){const response=await fetch(`/api/log?name=${encodeURIComponent(name)}`);if(!response.ok)return toast("FAILED · Log unavailable");$("#logTitle").textContent=name;$("#logText").textContent=await response.text();$("#logDialog").showModal()}
function toast(message){const box=$("#toast");box.textContent=message;box.classList.add("show");clearTimeout(box.timer);box.timer=setTimeout(()=>box.classList.remove("show"),5000)}
function formatBytes(bytes){return bytes<1024?`${bytes} B`:`${Math.round(bytes/1024)} KB`}

document.addEventListener("click",(event)=>{const inspectButton=event.target.closest("[data-inspect]");if(inspectButton)return inspect(inspectButton.dataset.inspect);const actionButton=event.target.closest("[data-action]");if(actionButton)return ask(actionButton.dataset.action,actionButton.dataset.loop);const logButton=event.target.closest("[data-log]");if(logButton)return openLog(logButton.dataset.log)});
$("#tick").addEventListener("click",()=>ask("run","implement"));$("#closeDrawer").addEventListener("click",closeDrawer);$("#scrim").addEventListener("click",closeDrawer);$("#confirm").addEventListener("close",()=>{$("#confirm").returnValue==="confirm"&&act()});$("#closeLog").addEventListener("click",()=>$("#logDialog").close());
document.addEventListener("keydown",(event)=>{if(event.key==="Escape")closeDrawer()});document.addEventListener("visibilitychange",()=>{clearInterval(refreshTimer);if(!document.hidden)refreshTimer=setInterval(()=>load(true),8000)});
load(true);refreshTimer=setInterval(()=>load(true),8000);
