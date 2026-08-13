// Collectish web v0.5.8 — paired PC/cloud verification + mismatch detail
(() => {
  const VERSION="0.5.8",el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v058]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v058.css?v=058';l.dataset.collectishV058='1';document.head.appendChild(l)}

  function session(){try{return JSON.parse(localStorage.getItem("collectishSession")||"null")}catch{return null}}
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path,{method="GET",body=null,prefer=null}={}){
    const s=session(),c=cfg();if(!s?.token||!s?.user?.id)throw Error("Sign in required.");
    const h={apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,"Content-Type":"application/json"};if(prefer)h.Prefer=prefer;
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{method,headers:h,body:body==null?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }
  const n=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const esc=s=>String(s??"").replace(/[&<>\"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));

  function install(){
    const parity=el("collectishParity");if(!parity||el("queuePairedVerification"))return false;
    const toolbar=parity.querySelector('.toolbar');
    const btn=document.createElement('button');btn.id='queuePairedVerification';btn.type='button';btn.textContent='Queue paired test';
    toolbar?.appendChild(btn);
    const note=document.createElement('div');note.className='collectish-pair-note';note.innerHTML='<b>Paired test:</b> queues the same current New scan profile once to the PC connector and once to the cloud worker. The parity checker links the two jobs instead of using an older baseline.';
    toolbar?.insertAdjacentElement('afterend',note);
    btn.onclick=queuePair;
    el('refreshParity')?.addEventListener('click',()=>setTimeout(loadEnhancedParity,100));
    loadEnhancedParity();return true;
  }

  async function queuePair(){
    const msg=el('newScanMsg'),s=session();
    try{
      const set=el('newSet')?.selectedOptions?.[0];if(!set?.value)throw Error('Select a set in New scan first.');
      const profile={setSlug:set.value,setName:set.dataset.name||set.textContent,printing:el('newPrinting')?.value||'Both',condition:el('newCondition')?.value||'Near Mint',language:el('newLanguage')?.value||'English',salesEnrich:Number(el('newEnrich')?.value||0),scanDepth:'Full'};
      const pairId=crypto.randomUUID(),now=new Date().toISOString();
      const base={user_id:s.user.id,source:'marketplace',action:'scan_set',status:'queued',required_capability:'marketplace_scan',max_attempts:3};
      await rest('collector_jobs',{method:'POST',body:[
        {...base,priority:40,preferred_executor:'browser_connector',payload_json:{profile,verificationPairId:pairId,verificationRole:'pc'},progress_json:{stage:'queued',percent:0,detail:'Paired verification: waiting for PC connector',pairId,updatedAt:now}},
        {...base,priority:40,preferred_executor:'verification',payload_json:{profile,verificationPairId:pairId,verificationRole:'cloud'},progress_json:{stage:'queued',percent:0,detail:'Paired verification: waiting for cloud worker',pairId,updatedAt:now}}
      ],prefer:'return=minimal'});
      if(msg)msg.textContent=`Queued paired verification for ${profile.setName}. PC and cloud jobs share pair ${pairId.slice(0,8)}…`;
      el('refreshCollectishJobs')?.click();setTimeout(loadEnhancedParity,250);
    }catch(e){if(msg)msg.textContent=e.message}
  }

  function mismatchHtml(m){
    const bits=[];
    if(m.directLow)bits.push(`Direct $${n(m.directLow.pc)}→$${n(m.directLow.cloud)}`);
    if(m.directAvailable)bits.push(`qty ${m.directAvailable.pc}→${m.directAvailable.cloud}`);
    if(m.directListings)bits.push(`Direct listings ${m.directListings.pc}→${m.directListings.cloud}`);
    if(m.marketplaceListings)bits.push(`market listings ${m.marketplaceListings.pc}→${m.marketplaceListings.cloud}`);
    if(m.salesVelocity)bits.push(`sales/day ${n(m.salesVelocity.pc)}→${n(m.salesVelocity.cloud)}`);
    if(m.score)bits.push(`score ${m.score.pc}→${m.score.cloud}`);
    if(m.flag)bits.push(`${m.flag.pc}→${m.flag.cloud}`);
    return `<li><b>${esc(m.productName||`SKU ${m.skuId}`)}</b><span>SKU ${esc(m.skuId)} • ${bits.map(esc).join(' • ')}</span></li>`;
  }

  async function loadEnhancedParity(){
    const host=el('parityBody');if(!host)return;
    try{
      const jobs=await rest('collector_jobs?select=job_id,status,created_at,completed_at,claimed_by,payload_json,progress_json,error_message&source=eq.marketplace&action=eq.scan_set&preferred_executor=eq.verification&order=created_at.desc&limit=10');
      if(!jobs?.length)return;
      host.innerHTML=jobs.map(j=>{
        const p=j.payload_json?.profile||{},par=j.progress_json?.parity||null,ps=j.progress_json?.parityStatus||par?.status||null,pair=j.payload_json?.verificationPairId;
        const cls=ps?` parity-${String(ps).toLowerCase()}`:'';
        const exact=par?`${n(par.directLowMatchPct)}% exact / ${n(par.directLowTolerantMatchPct??par.directLowMatchPct)}% tolerant Direct Low`:'';
        const core=par?`Qty ${n(par.directAvailableMatchPct)}% • Direct listings ${n(par.directListingsMatchPct)}% • Market listings ${n(par.marketplaceListingsMatchPct)}% • Sales ${n(par.salesVelocityMatchPct)}%`:'';
        const samples=par?.mismatchSamples?.length?`<details class="parity-mismatches"><summary>${par.mismatchSamples.length} mismatch samples</summary><ul>${par.mismatchSamples.map(mismatchHtml).join('')}</ul></details>`:'';
        return `<div class="collectish-parity-row${cls}"><div><strong>${esc(p.setName||p.setSlug||'Marketplace scan')}</strong><div class="meta">${esc(p.printing||'Both')} / ${esc(p.condition||'Near Mint')} / ${esc(p.language||'English')} • Top ${Number(p.salesEnrich||0)}${pair?` • pair ${esc(pair.slice(0,8))}…`:''}</div></div><div><span class="collectish-job-status s-${esc(j.status)}">${esc(j.status)}</span>${ps?`<div class="parity-result"><b>${esc(ps)}</b> • ${n(par.skuOverlapPct)}% SKU overlap • ${exact} • ${n(par.scoreMatchPct)}% score</div><div class="meta">${core}</div><div class="meta">PC ↔ cloud ${n(par.minutesApart)} min apart</div>${samples}`:'<div class="parity-result">Parity check pending</div>'}${j.error_message?`<div class="meta">${esc(j.error_message)}</div>`:''}</div></div>`;
      }).join('');
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }

  document.addEventListener('click',e=>{if(e.target?.dataset?.page==='operations')setTimeout(loadEnhancedParity,150)},true);
  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>180)clearInterval(t)},100);
  const badge=el('appVersion');if(badge)new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
})();

// Chain cloud-default executor release.
(()=>{
  if(document.querySelector('script[data-collectish-v059]'))return;
  const s=document.createElement('script');s.src='v059.js?v=059';s.dataset.collectishV059='1';document.body.appendChild(s);
})();