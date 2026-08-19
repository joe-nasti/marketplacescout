// Ask Collectish Investigate presentation — event-driven only, no observers/RPCs.
(() => {
  const labels=['THESIS','EVIDENCE','RISKS','DATA QUALITY','ENTRY','EXIT','EXIT / TARGET','TARGET','POSITION SIZE','CORE SETUP','COVERAGE','GAPS'];
  function splitLabel(el){
    if(!el||el.tagName!=='P')return;
    const text=el.textContent?.trim()||'';
    for(const label of labels){
      const re=new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*:\\s*`,'i');
      if(!re.test(text))continue;
      const rest=text.replace(re,'').trim();
      const h=document.createElement('h2');h.className='cx-investigate-section';h.textContent=label==='EXIT'?'EXIT / TARGET':label;
      el.before(h);
      if(rest)el.textContent=rest;else el.remove();
      return;
    }
  }
  function badgeFrom(el,label,kind){
    if(!el||el.tagName!=='P')return null;
    const text=el.textContent?.trim()||'';
    const re=new RegExp(`^${label}\\s*:\\s*(.+)$`,'i');
    const m=re.exec(text);if(!m)return null;
    const badge=document.createElement('span');badge.className=`cx-investigate-badge ${kind}`;badge.innerHTML=`<small>${label}</small><b>${m[1].trim()}</b>`;
    el.remove();return badge;
  }
  function enhance(el){
    if(!el||el.dataset?.investigateUi==='1')return;
    const text=el.textContent||'';
    if(!/^\s*VERDICT\s*:/i.test(text)||!/CONFIDENCE\s*:/i.test(text))return;
    const children=[...el.children];
    const verdict=badgeFrom(children.find(x=>/^VERDICT\s*:/i.test(x.textContent||'')),'VERDICT','verdict');
    const confidence=badgeFrom([...el.children].find(x=>/^CONFIDENCE\s*:/i.test(x.textContent||'')),'CONFIDENCE','confidence');
    if(verdict||confidence){const row=document.createElement('div');row.className='cx-investigate-summary';if(verdict)row.append(verdict);if(confidence)row.append(confidence);el.prepend(row)}
    [...el.children].forEach(splitLabel);
    const firstHr=el.querySelector('hr');if(firstHr?.previousElementSibling?.classList?.contains('cx-investigate-summary'))firstHr.remove();
    el.dataset.investigateUi='1';
  }
  function schedule(el){[0,40,120].forEach(ms=>setTimeout(()=>enhance(el),ms))}
  document.addEventListener('collectish:ask-message-rendered',e=>{if(e.detail?.role==='assistant')schedule(e.detail.element)});
  document.addEventListener('click',e=>{if(e.target.closest?.('#cxAskInvestigate'))setTimeout(()=>document.querySelectorAll('#cxAskMessages .cx-ask-assistant .cx-ask-msg-body[data-md]').forEach(enhance),350)},true);
  window.CollectishEnhanceInvestigate=enhance;
})();