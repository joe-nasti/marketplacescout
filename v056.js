// Collectish web v0.5.6 — explicit PC vs cloud verification executor
(() => {
  const VERSION="0.5.6", el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();

  function session(){
    try{return JSON.parse(localStorage.getItem("collectishSession")||"null")}catch{return null}
  }
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path,{method="GET",body=null,prefer=null}={}){
    const s=session(),c=cfg();if(!s?.token||!s?.user?.id)throw new Error("Sign in required.");
    const h={apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,"Content-Type":"application/json"};if(prefer)h.Prefer=prefer;
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{method,headers:h,body:body==null?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw new Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }

  function installExecutor(){
    const queue=el("queueNew"),form=queue?.closest(".form-grid");if(!queue||!form)return false;
    if(!el("collectishExecutor")){
      const label=document.createElement("label");label.id="collectishExecutorLabel";label.innerHTML=`Executor<select id="collectishExecutor"><option value="browser_connector" selected>PC connector</option><option value="verification">Cloud verification</option></select><small class="subtle">Cloud verification is isolated from normal PC jobs until parity testing is complete.</small>`;
      form.insertBefore(label,queue);
    }
    return true;
  }

  async function queueVerification(){
    const msg=el("newScanMsg"),s=session();
    try{
      if(!s?.user?.id)throw new Error("Sign in required.");
      const set=el("newSet")?.selectedOptions?.[0];if(!set?.value)throw new Error("Select a set.");
      const profile={setSlug:set.value,setName:set.dataset.name||set.textContent,printing:el("newPrinting")?.value||"Both",condition:el("newCondition")?.value||"Near Mint",language:el("newLanguage")?.value||"English",salesEnrich:Number(el("newEnrich")?.value||0),scanDepth:"Full"};
      if(msg)msg.textContent="Queueing cloud verification job…";
      await rest("collector_jobs",{method:"POST",body:[{user_id:s.user.id,source:"marketplace",action:"scan_set",status:"queued",priority:50,required_capability:"marketplace_scan",preferred_executor:"verification",payload_json:{profile},progress_json:{stage:"queued",percent:0,detail:"Waiting for cloud verification worker",updatedAt:new Date().toISOString()},max_attempts:3}],prefer:"return=minimal"});
      if(msg)msg.textContent=`Queued ${profile.setName} for cloud verification. Run the Marketplace cloud worker workflow from GitHub Actions.`;
      el("refreshCollectishJobs")?.click();
    }catch(e){if(msg)msg.textContent=e.message}
  }

  document.addEventListener("click",e=>{
    const b=e.target?.closest?.("#queueNew");if(!b)return;
    if(el("collectishExecutor")?.value!=="verification")return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    queueVerification();
  },true);

  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(installExecutor()||tries>160)clearInterval(t)},100);
  const observer=new MutationObserver(setBadge);const badge=el("appVersion");if(badge)observer.observe(badge,{childList:true,characterData:true,subtree:true});
})();
