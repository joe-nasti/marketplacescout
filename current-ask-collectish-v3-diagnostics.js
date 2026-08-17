// Ask Collectish V3 diagnostics correction — authoritative daily conversation count.
(() => {
  async function rpc(name,body={}){return window.rest(`rpc/${name}`,{method:'POST',body})}
  async function patch(){
    const host=document.querySelector('#cxAdmin .cx-v3-diagnostics');
    if(!host||host.dataset.v3SummaryPatched==='1')return;
    try{
      const d=await rpc('ask_collectish_v3_diagnostics_summary');
      const list=host.querySelector('.cx-detail-list');
      if(!list)return;
      const stat=document.createElement('div');
      stat.className='cx-detail-stat cx-v3-daily-conversations';
      stat.innerHTML=`<span>Daily conversations</span><strong>${Number(d?.daily_conversations||0).toLocaleString()}</strong>`;
      const requests=[...list.querySelectorAll('.cx-detail-stat')].find(x=>x.querySelector('span')?.textContent?.trim()==='Requests today');
      if(requests)requests.before(stat);else list.append(stat);
      host.dataset.v3SummaryPatched='1';
    }catch{}
  }
  const mo=new MutationObserver(()=>patch());
  function start(){const a=document.getElementById('cxAdmin');if(a)mo.observe(a,{childList:true,subtree:true});patch()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  document.addEventListener('collectish:ready',start);
})();
