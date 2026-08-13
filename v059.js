// Collectish web v0.5.9 — cloud-primary Marketplace execution with PC fallback
(() => {
  const VERSION='0.5.9',el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el('appVersion');if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v059]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v059.css?v=059';l.dataset.collectishV059='1';document.head.appendChild(l)}
  function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path,{method='GET',body=null,prefer=null}={}){
    const s=session(),c=cfg();if(!s?.token||!s?.user?.id)throw Error('Sign in required.');
    const h={apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'};if(prefer)h.Prefer=prefer;
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{method,headers:h,body:body==null?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }
  function install(){
    const sel=el('collectishExecutor'),queue=el('queueNew');if(!sel||!queue)return false;
    if(!sel.querySelector('option[value="cloud_worker"]')){
      sel.innerHTML='<option value="cloud_worker">Cloud worker (default)</option><option value="browser_connector">PC connector fallback</option><option value="verification">Cloud verification</option>';
    }
    sel.value='cloud_worker';
    const small=el('collectishExecutorLabel')?.querySelector('small');if(small)small.textContent='Cloud is now the primary Marketplace executor. Failed cloud jobs are requeued automatically to the PC connector.';
    if(!el('collectishCloudPrimaryBadge')){
      const badge=document.createElement('div');badge.id='collectishCloudPrimaryBadge';badge.className='collectish-cloud-primary';badge.innerHTML='<b>Cloud primary</b><span>Marketplace scans run server-side first. PC v0.15.6 remains the fallback executor.</span>';
      queue.closest('.form-grid')?.insertAdjacentElement('beforebegin',badge);
    }
    return true;
  }
  async function queueCloudPrimary(){
    const msg=el('newScanMsg'),s=session();
    try{
      const set=el('newSet')?.selectedOptions?.[0];if(!set?.value)throw Error('Select a set.');
      const profile={setSlug:set.value,setName:set.dataset.name||set.textContent,printing:el('newPrinting')?.value||'Both',condition:el('newCondition')?.value||'Near Mint',language:el('newLanguage')?.value||'English',salesEnrich:Number(el('newEnrich')?.value||0),scanDepth:'Smart'};
      if(msg)msg.textContent='Queueing cloud Marketplace scan…';
      await rest('collector_jobs',{method:'POST',body:[{user_id:s.user.id,source:'marketplace',action:'scan_set',status:'queued',priority:30,required_capability:'marketplace_scan',preferred_executor:'cloud_worker',payload_json:{profile,cloudPrimary:true},progress_json:{stage:'queued',percent:0,detail:'Waiting for Collectish cloud worker',updatedAt:new Date().toISOString()},max_attempts:3}],prefer:'return=minimal'});
      if(msg)msg.textContent=`Queued ${profile.setName} for cloud execution. The worker checks about every 5 minutes; PC fallback is automatic if cloud execution fails.`;
      el('refreshCollectishJobs')?.click();
    }catch(e){if(msg)msg.textContent=e.message}
  }
  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('#queueNew');if(!b)return;
    if(el('collectishExecutor')?.value!=='cloud_worker')return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();queueCloudPrimary();
  },true);
  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>180)clearInterval(t)},100);
  const badge=el('appVersion');if(badge)new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
})();
