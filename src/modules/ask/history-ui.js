const CONV_KEY='askCollectishConversationId';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clip=(s,n=118)=>{const x=String(s||'').replace(/\s+/g,' ').trim();return x.length>n?`${x.slice(0,n-1)}…`:x};

async function historyData(){
  const conversations=await window.rest('ask_collectish_conversations?select=id,title,updated_at,created_at&order=updated_at.desc&limit=30');
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

function rowMarkup(c,preview){
  const when=new Date(c.updated_at||c.created_at);
  const active=c.id===activeId();
  const title=clip(c.title||preview||'Untitled conversation',72);
  const sub=clip(preview&&preview!==c.title?preview:'',130);
  return `<span class="cx-ask-history-main"><span class="cx-ask-history-title">${esc(title)}${active?'<b class="cx-ask-history-active">Active</b>':''}</span>${sub?`<span class="cx-ask-history-preview">${esc(sub)}</span>`:''}<span class="cx-ask-history-time">${esc(when.toLocaleString())}</span></span><span class="cx-ask-history-delete" role="button" tabindex="0" aria-label="Delete conversation" title="Delete conversation">Delete</span>`;
}

async function enhanceHistory(){
  const host=document.getElementById('cxAskMessages');
  if(!host)return;
  let data;
  try{data=await historyData()}catch{return}
  const buttons=[...host.querySelectorAll(':scope > .cx-ask-starter')];
  if(!buttons.length||buttons.length!==data.conversations.length)return;
  buttons.forEach((b,i)=>{
    const c=data.conversations[i];
    if(!c)return;
    b.classList.add('cx-ask-history-row');
    if(c.id===activeId())b.classList.add('is-active');
    b.innerHTML=rowMarkup(c,data.firstUser.get(c.id)||'');
    const del=b.querySelector('.cx-ask-history-delete');
    const remove=async e=>{
      e.preventDefault();e.stopPropagation();
      const label=clip(c.title||data.firstUser.get(c.id)||'this conversation',50);
      if(!window.confirm(`Delete \"${label}\"? This removes the saved Ask session and its messages.`))return;
      del.textContent='Deleting…';
      del.setAttribute('aria-disabled','true');
      try{
        await window.rest(`ask_collectish_conversations?id=eq.${encodeURIComponent(c.id)}`,{method:'DELETE'});
        if(c.id===activeId())document.querySelector('#cxAskCollectish .cx-ask-new')?.click();
        b.remove();
        const left=host.querySelectorAll(':scope > .cx-ask-history-row').length;
        const status=document.getElementById('cxAskStatus');if(status)status.textContent=`${left} saved conversation${left===1?'':'s'}`;
      }catch(err){del.textContent='Delete';del.removeAttribute('aria-disabled');const status=document.getElementById('cxAskStatus');if(status){status.textContent='Delete failed';status.dataset.kind='bad'}console.error('Ask history delete failed',err)}
    };
    del.addEventListener('click',remove);
    del.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();remove(e)}});
  });
}

export function installAskHistoryUi(){
  const hook=()=>{
    const root=document.getElementById('cxAskCollectish');
    const history=root?.querySelector('.cx-ask-history');
    if(!history||history.dataset.historyEnhanced)return false;
    history.dataset.historyEnhanced='1';
    history.addEventListener('click',()=>{setTimeout(enhanceHistory,80);setTimeout(enhanceHistory,260)});
    return true;
  };
  if(hook())return;
  // Ask is route-lazy. Retry briefly after install rather than owning DOM lifecycle with an observer.
  for(const delay of [80,220,500,1000,1800])setTimeout(hook,delay);
  document.addEventListener('collectish:ready',hook,{once:true});
}
