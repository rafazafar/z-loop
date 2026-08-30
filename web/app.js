let state;let pending;let refreshTimer;
const $=(selector)=>document.querySelector(selector);
const esc=(value="")=>String(value).replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const LOOP_NAMES={"spec-sync":"Write Specs","ticket-factory":"Plan Tickets","decision-desk":"Queue Decisions",implement:"Build & Verify",gardener:"Propose Issues"};
const ROLE_NAMES={implementer:"Code Implementer",reviewer:"Independent Verifier",ticketer:"Ticket Planner",distiller:"Specification Writer",gardener:"Improvement Analyst","decision-desk":"Decision Queue Builder"};
const title=(id)=>LOOP_NAMES[id]||id.split("-").map((word)=>word[0].toUpperCase()+word.slice(1)).join(" ");
function sessionLabel(session,compact=false){let match=session.id.match(/^(\d+)-impl-a(\d+)$/);if(match)return compact?`#${match[1]} · Coding · Try ${match[2]}`:`Issue #${match[1]} · Implementing · Attempt ${match[2]}`;match=session.id.match(/^(\d+)-rev-(code|security|safety|qms)-r(\d+)$/);if(match){const profile={code:"Code",security:"Security",safety:"Safety",qms:"QMS"}[match[2]];return compact?`#${match[1]} · ${profile} review · R${match[3]}`:`Issue #${match[1]} · ${profile} review · Round ${match[3]}`};match=session.id.match(/^(\d+)-rev-r(\d+)$/);if(match)return compact?`#${match[1]} · Review · Round ${match[2]}`:`Issue #${match[1]} · Reviewing · Round ${match[2]}`;if(session.id.startsWith(`loop-${session.loop}-`))return`${title(session.loop)} · ${session.role==="reviewer"?"Verifying":ROLE_NAMES[session.role]||"Working"}`;return session.id;}
const currentWork=(loop,compact=false)=>{const session=state.sessions.find((item)=>item.loop===loop.id&&item.status==="running");return session?sessionLabel(session,compact):"Idle"};
const stamp=(loop)=>loop.unavailable?"NOT READY":loop.status.toUpperCase();
const mdInline=(s)=>s.replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(match,text,url)=>/^(https?:\/\/|\/|#)/.test(url)?`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`:match).replace(/(^|[\s(])(https?:\/\/[^\s<>)]+)/g,(match,pre,url)=>{const clean=url.replace(/[.,;:!?]+$/,"");const tail=url.slice(clean.length);return `${pre}<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${tail}`});
const md=(text)=>{
  const body=text.replace(/\r\n/g,"\n").replace(/^---\n[\s\S]*?\n---\n?/,"").replace(/^\n+/,"").replace(/^#[^\n]*\n+/,"");
  let html="",list=false,para=[];
  const flush=()=>{if(para.length){html+=`<p>${mdInline(esc(para.join(" ")))}</p>`;para=[]}};
  const closeList=()=>{if(list){html+="</ul>";list=false}};
  for(const line of body.split("\n")){
    const trimmed=line.trim();
    if(!trimmed){flush();closeList();continue}
    let match;
    if((match=trimmed.match(/^(#{1,4})\s+(.+)$/))){flush();closeList();const level=Math.min(match[1].length+1,5);html+=`<h${level}>${mdInline(esc(match[2]))}</h${level}>`;continue}
    if((match=trimmed.match(/^[-*]\s+(.+)$/))){flush();if(!list){html+="<ul>";list=true}html+=`<li>${mdInline(esc(match[1]))}</li>`;continue}
    closeList();para.push(trimmed);
  }
  flush();closeList();return html;
};
const node=(loop)=>`<button class="graph-node n-${loop.id} ${loop.status} ${loop.unavailable?"unavailable":""}" data-inspect="${loop.id}"><strong>${title(loop.id)}</strong><span class="stamp">${esc(stamp(loop))}</span><small>${esc(loop.cadence)} · ${loop.timerLoaded?"armed":"not armed"}</small><small>${esc(currentWork(loop,true))}</small><small class="mobile-flow">OUTPUT → ${esc(loop.produces)}</small></button>`;
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
  $("#loopGrid").innerHTML=state.loops.map((loop)=>`<article class="loop-card ${esc(loop.status)} ${loop.unavailable?"unavailable":""}"><div class="card-top"><h3>${title(loop.id)}</h3><span class="badge">${esc(stamp(loop))}</span></div><div class="facts">${fact("TRIGGER",loop.cadence)}${fact("TIMER",loop.timerLoaded?"Armed":"Not loaded")}${fact("CURRENT WORK",currentWork(loop))}${fact("LAST EVENT",loop.timeline[0]||"Never")}</div><div class="actions"><button class="primary" data-action="run" data-loop="${loop.id}" ${!loop.triggerable?"disabled":""}>Run now</button><button data-action="toggle" data-loop="${loop.id}">${loop.status==="active"?"Pause":"Resume"}</button><button data-inspect="${loop.id}">Inspect</button></div>${loop.unavailable?`<p class="reason">${esc(loop.unavailable)}</p>`:""}</article>`).join("");
  const roles=Object.entries(state.routing.roles).map(([name,role])=>`<div class="route-row"><span>${esc(ROLE_NAMES[name]||name)}</span><span>${esc(role.model)} · ${esc(role.variant)}</span></div>`).join("");
  $("#routing").innerHTML=`<div class="route-table"><h3>Worker roles</h3>${roles}</div>`;
  const cards=state.cards.slice().sort((a,b)=>(a.status==="open"?0:1)-(b.status==="open"?0:1)||a.name.localeCompare(b.name));
  $("#cards").innerHTML=cards.map((card)=>{
    const options=[...card.text.matchAll(/^## Option ([A-Z]) — (.+)$/gm)];
    const form=card.status==="open"?`<form class="card-answer" data-card="${esc(card.name)}">${options.map((match)=>`<label class="card-opt"><input type="radio" name="opt-${esc(card.name)}" value="${match[1]}" required> <b>${esc(match[1])}</b> — ${esc(match[2])}</label>`).join("")}<textarea name="note" maxlength="2000" placeholder="optional reasoning — recorded in the card"></textarea><button class="primary" type="submit">Record answer</button></form>`:"";
    return `<details class="card-tile"><summary><span class="badge ${card.status==="open"?"open":""}">${esc(card.status.toUpperCase())}</span> ${esc(card.title)}</summary><p class="card-file">${esc(card.name)}</p><div class="card-md">${md(card.text)}</div>${form}</details>`;
  }).join("")||'<p class="reason">No decision cards yet.</p>';
}

function inspect(id){
  const loop=state.loops.find((item)=>item.id===id);const sessions=state.sessions.filter((item)=>item.loop===id);const logs=state.logs.filter((log)=>sessions.some((session)=>session.log===log.name));
  $("#drawerBody").innerHTML=`<span class="eyebrow">WORKFLOW DETAIL · domains/${id}/README.md</span><h2>${title(id)}</h2><span class="badge">${esc(stamp(loop))}</span><p class="goal">${esc(loop.goal)}</p><div class="flow"><div><span>CONSUMES</span>${esc(loop.consumes)}</div><div><span>PRODUCES</span>${esc(loop.produces)}</div></div><section class="drawer-section"><h3>Recent timeline</h3>${loop.timeline.map((line)=>`<div class="ticket">${esc(line)}</div>`).join("")||"<p>No runs recorded.</p>"}</section><section class="drawer-section"><h3>Worker sessions</h3>${sessions.map((session)=>`<details class="session"><summary>${esc(sessionLabel(session))} · ${esc(session.status)}</summary><p><strong>${esc(ROLE_NAMES[session.role]||session.role)}</strong> · ${esc(session.route)}</p><p>Runtime ID: <code>${esc(session.id)}</code></p><pre>${esc(session.result||"No result written.")}</pre></details>`).join("")||"<p>No worker sessions for this workflow.</p>"}</section><section class="drawer-section"><h3>Logs</h3>${logs.map((log)=>`<button class="log-link" data-log="${esc(log.name)}">${esc(log.name)} · ${formatBytes(log.size)}</button>`).join("")||"<p>No logs for this workflow.</p>"}</section>`;
  $("#drawer").classList.add("open");$("#scrim").classList.add("open");$("#drawer").setAttribute("aria-hidden","false");
}

function closeDrawer(){$("#drawer").classList.remove("open");$("#scrim").classList.remove("open");$("#drawer").setAttribute("aria-hidden","true")}
function ask(action,loop){pending={action,loop};const item=state.loops.find((entry)=>entry.id===loop);$("#confirmTitle").textContent=`${action==="run"?"Run":"Change"} ${title(loop)}`;$("#confirmText").textContent=action==="run"?`Start one ${item.cadence.toLowerCase()} check now. This command is safe to re-run.`:`${item.status==="active"?"Pause":"Resume"} this loop. Running sessions are not stopped.`;$("#confirm").showModal()}
async function act(){try{const response=await fetch("/api/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(pending)});const result=await response.json();toast(!response.ok||result.ok===false?`FAILED · ${result.output||result.error}`:result.output||"Action complete");await load(true)}catch(error){toast(`FAILED · ${error.message}`)}}
async function openLog(name){const response=await fetch(`/api/log?name=${encodeURIComponent(name)}`);if(!response.ok)return toast("FAILED · Log unavailable");$("#logTitle").textContent=name;$("#logText").textContent=await response.text();$("#logDialog").showModal()}
function toast(message){const box=$("#toast");box.textContent=message;box.classList.add("show");clearTimeout(box.timer);box.timer=setTimeout(()=>box.classList.remove("show"),5000)}
function formatBytes(bytes){return bytes<1024?`${bytes} B`:`${Math.round(bytes/1024)} KB`}

document.addEventListener("click",(event)=>{const inspectButton=event.target.closest("[data-inspect]");if(inspectButton)return inspect(inspectButton.dataset.inspect);const actionButton=event.target.closest("[data-action]");if(actionButton)return ask(actionButton.dataset.action,actionButton.dataset.loop);const logButton=event.target.closest("[data-log]");if(logButton)return openLog(logButton.dataset.log)});
document.addEventListener("submit",async(event)=>{const form=event.target.closest(".card-answer");if(!form)return;event.preventDefault();const option=form.querySelector("input[type=radio]:checked");try{const response=await fetch("/api/decide",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({card:form.dataset.card,option:option?.value,note:form.note.value})});const result=await response.json();toast(!response.ok||result.ok===false?`FAILED · ${result.output||result.error}`:result.output||"Decision recorded");await load(true)}catch(error){toast(`FAILED · ${error.message}`)}});
$("#tick").addEventListener("click",()=>ask("run","implement"));$("#closeDrawer").addEventListener("click",closeDrawer);$("#scrim").addEventListener("click",closeDrawer);$("#confirm").addEventListener("close",()=>{$("#confirm").returnValue==="confirm"&&act()});$("#closeLog").addEventListener("click",()=>$("#logDialog").close());
document.addEventListener("keydown",(event)=>{if(event.key==="Escape")closeDrawer()});document.addEventListener("visibilitychange",()=>{clearInterval(refreshTimer);if(!document.hidden)refreshTimer=setInterval(()=>load(true),8000)});
load(true);refreshTimer=setInterval(()=>load(true),8000);
