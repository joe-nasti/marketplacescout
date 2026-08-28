const CONV_KEY='askCollectishConversationId';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clip=(s,n=118)=>{const x=String(s||'').replace(/\s+/g,' ').trim();return x.length>n?`${x.slice(0,n-1)}…`:x};
let restPatched=false,archiveMode=false;

function patchConversationReads(){
  if(restPatched||typeof window.rest!=='function')return false;
  const original=window.rest;
  window.rest=async function(path,opt){
    let next=path;
    const method=String(opt?.method||'GET').toUpperCase();
    if(method==='GET'&&typeof next==='string'&&next.startsWith('ask_collectish_conversations?')&&!next.includes('archived_at=')){
      next+=`${next.includes('?')?'&':'?'}archived_at=is.null`;
    }
    return original.call(this,next,opt);
  };
  restPatched=true;
  return true;
}

function ensureRestPatch(){
  if(patchConversationReads())return;
  let tries=0;
  const timer=setInterval(()=>{tries++;if(patchConversationReads()||tries>100)clearInterval(timer)},50);
}

async function historyData(archived=false){
  const filter=archived?'archived_at=not.is.null':'archived_at=is.null';
  const conversations=await window.rest(`ask_collectish_conversations?select=id,title,updated_at,created_at,archived_at&${filter}&order=updated_at.desc&limit=30`);
  if(!Array.isArray(conversations)||!conversations.length)return {conversations:[],firstUser:new Map()};
  const ids=conversations.map(x=>x.id).filter(Boolean);
  const encoded=ids.map(id=>`\"${String(id).replaceAll('"','')}\"`).join(',');
  let messages=[];
  try{messages=await window.rest(`ask_collectish_messages?select=conversation_id,content,created_at&role=eq.user&conversation_id=in.(${encodeURIComponent(encoded)})&order=created_at.asc&limit=500`)}catch{}
  const firstUser=new Map();
  for(const m of Array.isArray(messages)?messages:[])if(!firstUser.has(m.conversation_id))firstUser.set(m.conversation_id,m.content||'');
  return {conversations,firstUser};
}

function activeId(){return localStorage.getItem(CONV_KEY)||''}

function rowMarkup(c,preview,archived=false){
  const when=new Date(c.updated_at||c.created_at);
  const active=!archived&&c.id===activeId();
  const title=clip(c.title||preview||'Untitled conversation',72);
  const sub=clip(preview&&preview!==c.title?preview:'',130);
  const archivedWhen=archived&&c.archived_at?` · Archived ${new Date(c.archived_at).toLocaleString()}`:'';
  return `<span class="cx-ask-history-main"><span class="cx-ask-history-title">${esc(title)}${active?'<b class="cx-ask-history-active">Active</b>':''}</span>${sub?`<span class="cx-ask-history-preview">${esc(sub)}</span>`:''}<span class="cx-ask-history-time">${esc(when.toLocaleString()+archivedWhen)}</span></span><span class="cx-ask-history-actions"><span class="cx-ask-history-archive" role="button" tabindex="0" aria-label="${archived?'Unarchive':'Archive'} conversation" title="${archived?'Unarchive':'Archive'} conversation">${archived?'Unarchive':'Archive'}</span><span class="cx-ask-history-delete" role="button" tabindex="0" aria-label="Delete conversation" title="Delete conversation">Delete</span></span>`;
}

function setStatus(text,kind=''){
  const status=document.getElementById('cxAskStatus');
  if(status){status.textContent=text;status.dataset.kind=kind}
}

function historyTabs(host){
  let tabs=host.querySelector('.cx-ask-history-tabs');
  if(tabs)return tabs;
  tabs=document.createElement('div');
  tabs.className='cx-ask-history-tabs';
  tabs.innerHTML=`<button type="button" data-history-mode="active">Active</button><button type="button" data-history-mode="archived">Archived</button>`;
  const welcome=host.querySelector(':scope > .cx-ask-welcome');
  welcome?.after(tabs);
  tabs.addEventListener('click',e=>{
    const b=e.target.closest('[data-history-mode]');if(!b)return;
    archiveMode=b.dataset.historyMode==='archived';
    renderHistoryMode().catch(err=>{console.error('Ask history mode failed',err);setStatus('History unavailable','bad')});
  });
  return tabs;
}

async function archiveConversation(c,row,archived){
  const control=row.querySelector('.cx-ask-history-archive');
  control.textContent=archived?'Restoring…':'Archiving…';control.setAttribute('aria-disabled','true');
  try{
    await window.rest(`ask_collectish_conversations?id=eq.${encodeURIComponent(c.id)}`,{method:'PATCH',body:{archived_at:archived?null:new Date().toISOString(),updated_at:new Date().toISOString()}});
    if(!archived&&c.id===activeId())document.querySelector('#cxAskCollectish .cx-ask-new')?.click();
    await renderHistoryMode();
  }catch(err){control.textContent=archived?'Unarchive':'Archive';control.removeAttribute('aria-disabled');setStatus(archived?'Unarchive failed':'Archive failed','bad');console.error('Ask history archive failed',err)}
}

async function deleteConversation(c,row,preview){
  const del=row.querySelector('.cx-ask-history-delete');
  const label=clip(c.title||preview||'this conversation',50);
  if(!window.confirm(`Delete \"${label}\"? This permanently removes the saved Ask session and its messages.`))return;
  del.textContent='Deleting…';del.setAttribute('aria-disabled','true');
  try{
    await window.rest(`ask_collectish_conversations?id=eq.${encodeURIComponent(c.id)}`,{method:'DELETE'});
    if(c.id===activeId())document.querySelector('#cxAskCollectish .cx-ask-new')?.click();
    await renderHistoryMode();
  }catch(err){del.textContent='Delete';del.removeAttribute('aria-disabled');setStatus('Delete failed','bad');console.error('Ask history delete failed',err)}
}

function wireAction(control,handler){
  control?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();handler(e)});
  control?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();handler(e)}});
}

async function renderHistoryMode(){
  const host=document.getElementById('cxAskMessages');if(!host)return;
  const data=await historyData(archiveMode);
  host.innerHTML=`<div class="cx-ask-welcome"><strong>${archiveMode?'Archived Ask sessions':'Recent Ask sessions'}</strong><span>${archiveMode?'Archived sessions stay on your Collectish account until you unarchive or delete them.':'Saved to your Collectish account and available after local site data is cleared.'}</span></div>`;
  const tabs=historyTabs(host);
  tabs.querySelectorAll('[data-history-mode]').forEach(b=>b.classList.toggle('is-active',(b.dataset.historyMode==='archived')===archiveMode));
  if(!data.conversations.length){const empty=document.createElement('div');empty.className='cx-empty';empty.textContent=archiveMode?'No archived conversations.':'No saved conversations yet.';host.append(empty);setStatus(empty.textContent);return}
  for(const c of data.conversations){
    const preview=data.firstUser.get(c.id)||'';
    const row=document.createElement('button');row.type='button';row.className='cx-ask-starter cx-ask-history-row';
    if(!archiveMode&&c.id===activeId())row.classList.add('is-active');
    row.innerHTML=rowMarkup(c,preview,archiveMode);
    if(archiveMode){row.addEventListener('click',e=>{if(e.target.closest('.cx-ask-history-actions'))return;archiveConversation(c,row,true)})}
    else row.addEventListener('click',()=>{});
    wireAction(row.querySelector('.cx-ask-history-archive'),()=>archiveConversation(c,row,archiveMode));
    wireAction(row.querySelector('.cx-ask-history-delete'),()=>deleteConversation(c,row,preview));
    host.append(row);
  }
  host.scrollTop=0;setStatus(`${data.conversations.length} ${archiveMode?'archived':'saved'} conversation${data.conversations.length===1?'':'s'}`,'ok');
}

async function enhanceHistory(){
  const host=document.getElementById('cxAskMessages');
  if(!host)return;
  archiveMode=false;
  const data=await historyData(false).catch(()=>null);if(!data)return;
  const buttons=[...host.querySelectorAll(':scope > .cx-ask-starter')];
  if(!buttons.length&&data.conversations.length){await renderHistoryMode();return}
  historyTabs(host).querySelector('[data-history-mode="active"]')?.classList.add('is-active');
  if(buttons.length!==data.conversations.length){await renderHistoryMode();return}
  buttons.forEach((b,i)=>{
    const c=data.conversations[i];if(!c)return;
    b.classList.add('cx-ask-history-row');if(c.id===activeId())b.classList.add('is-active');
    const preview=data.firstUser.get(c.id)||'';b.innerHTML=rowMarkup(c,preview,false);
    wireAction(b.querySelector('.cx-ask-history-archive'),()=>archiveConversation(c,b,false));
    wireAction(b.querySelector('.cx-ask-history-delete'),()=>deleteConversation(c,b,preview));
  });
}

export function installAskHistoryUi(){
  ensureRestPatch();
  const hook=()=>{
    const root=document.getElementById('cxAskCollectish');
    const history=root?.querySelector('.cx-ask-history');
    if(!history||history.dataset.historyEnhanced)return false;
    history.dataset.historyEnhanced='1';
    history.addEventListener('click',()=>{archiveMode=false;setTimeout(enhanceHistory,80);setTimeout(enhanceHistory,260)});
    return true;
  };
  if(hook())return;
  const obs=new MutationObserver(()=>{if(hook())obs.disconnect()});
  obs.observe(document.documentElement,{childList:true,subtree:true});
}
