// Ask Collectish deep-history sidecar.
// Detects deterministic collectible-cohort questions, requests shared historical
// coverage when needed, and surfaces completion without blocking the main Ask turn.
(() => {
  const CONV_KEY='askCollectishConversationId';
  let pollTimer=null;
  const seen=new Set();
  async function rpc(name,body={}){return window.rest(`rpc/${name}`,{method:'POST',body})}
  function askMessages(){return document.getElementById('cxAskMessages')}
  function addBubble(text,meta='Deep history'){
    const messages=askMessages();if(!messages)return;
    const w=document.createElement('div');w.className='cx-ask-msg cx-ask-assistant cx-ask-deep-history';
    const b=document.createElement('div');b.className='cx-ask-msg-body';b.textContent=text;w.append(b);
    if(meta){const s=document.createElement('small');s.textContent=meta;w.append(s)}
    messages.append(w);messages.scrollTop=messages.scrollHeight;
  }
  function toast(text){
    let el=document.getElementById('cxDeepHistoryToast');
    if(!el){el=document.createElement('button');el.type='button';el.id='cxDeepHistoryToast';el.style.cssText='position:fixed;right:18px;bottom:82px;z-index:10020;max-width:360px;padding:12px 14px;border-radius:12px;border:1px solid rgba(127,127,127,.35);box-shadow:0 8px 30px rgba(0,0,0,.28);background:var(--cx-surface,#15171b);color:var(--cx-text,#fff);text-align:left;font:inherit;cursor:pointer';el.onclick=()=>{document.dispatchEvent(new CustomEvent('collectish:open-ask'));el.remove()};document.body.append(el)}
    el.textContent=text;
  }
  function fmtMoney(v){const n=Number(v);return Number.isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0}):'—'}
  function fmtPct(v){const n=Number(v);return Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(1)}%`:'—'}
  function readyText(row){
    if(row.status==='failed')return `${(row.set_codes||[]).join(' + ')||'Collectible cohort'} ${row.treatment}: deeper history could not complete. ${row.error_message||'The provisional answer remains available.'}`;
    const s=row.result?.thesis?.summary||{},p=row.progress||{};
    return `${(row.set_codes||[]).join(' + ')||'Tracked sets'} ${row.treatment}: deep history is ready (${row.coverage_after_start||'—'} → ${row.coverage_after_end||'—'}). ${p.rows_imported??0} targeted historical price rows were added. The cumulative basket is ${fmtMoney(s.basket_current_value)} (${fmtPct(s.basket_change_pct)} from the historical starting point), with ${s.rising_count??0}/${s.printing_count??0} printings rising. Ask the question again for the full updated thesis.`;
  }
  async function checkReady(){
    try{
      const rows=await rpc('list_delvin_history_ready_for_app_v1',{p_limit:10});
      for(const row of Array.isArray(rows)?rows:[]){
        if(seen.has(row.subscription_id))continue;seen.add(row.subscription_id);
        const text=readyText(row),open=document.getElementById('cxAskCollectish')?.hidden===false;
        if(open)addBubble(text,'Deep history ready');else toast(`Delvin deep history ready: ${(row.set_codes||[]).join(' + ')} ${row.treatment}`);
        await rpc('ack_delvin_history_ready_for_app_v1',{p_subscription_id:row.subscription_id}).catch(()=>null);
      }
    }catch(e){console.warn('Ask deep-history ready check failed',e)}
  }
  async function maybeQueue(question){
    try{
      const route=await rpc('resolve_delvin_shared_query_v1',{p_question:question,p_limit:30});
      if(!route?.handled||route.route!=='collectible_cohort_thesis')return;
      const d=await rpc('ensure_delvin_collectible_history_v1',{
        p_treatment:route.treatment,
        p_set_codes:Array.isArray(route.set_codes)&&route.set_codes.length?route.set_codes:null,
        p_surface:'app',
        p_original_question:question,
        p_discord_user_id:null,p_discord_guild_id:null,p_discord_channel_id:null,p_discord_thread_id:null,
        p_collectish_user_id:null,
        p_ask_session_id:localStorage.getItem(CONV_KEY)||null
      });
      if(d?.needs_backfill){setTimeout(()=>addBubble(`Current history only reaches ${d.coverage_start||'the recent period'}. I queued a shared TCGCSV backfill toward ${d.desired_start||'release'} for ${d.product_count||'the matching'} printings. You can leave Ask; I’ll notify you in Collectish when the deeper history is ready.`,'Deep history queued'),900)}
    }catch(e){console.warn('Ask deep-history queue skipped',e)}
  }
  document.addEventListener('collectish:ask-message-rendered',event=>{
    if(event.detail?.role!=='user')return;
    const q=event.detail?.element?.textContent?.trim();if(q)void maybeQueue(q);
  });
  document.addEventListener('collectish:ask-opened',()=>{void checkReady();if(!pollTimer)pollTimer=setInterval(checkReady,30000)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkReady()});
})();
