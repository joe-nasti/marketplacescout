// Collectish Scout demand context renderer (EDHREC is one demand source)
(() => {
  let seq=0,lastName='';
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const num=n=>Number(n||0).toLocaleString();
  async function refresh(){
    const detail=document.getElementById('cxParityDetail');if(!detail)return;
    const title=detail.querySelector('.cx-detail-title .cx-section-title');if(!title)return;
    const name=title.textContent.trim();if(!name)return;
    const token=++seq;lastName=name;
    let old=detail.querySelector('.cx-edhrec-context');if(old)old.remove();
    try{
      const rows=await rest(`scout_opportunities_24h?select=base_score_24h,opportunity_score,demand_adjustment,demand_signal,demand_signal_score,demand_sources,edhrec_rank,computed_at&product_name=eq.${encodeURIComponent(name)}&order=opportunity_score.desc&limit=1`);
      if(token!==seq||lastName!==name||!rows?.[0])return;
      const r=rows[0],source=r.demand_sources?.edhrec||{},signal=r.demand_signal;if(!signal)return;
      const box=document.createElement('div');box.className=`cx-edhrec-context cx-edhrec-${String(signal).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;
      const rank=Number(source.rank??r.edhrec_rank??0),score=Number(r.demand_signal_score??0),adj=Number(r.demand_adjustment||0),base=Number(r.base_score_24h||0),final=Number(r.opportunity_score||0);
      const movement=[];if(Number(source.rankChange||0))movement.push(`rank ${Number(source.rankChange)>0?'+':''}${Number(source.rankChange)}`);if(Number.isFinite(Number(source.deckChangePct)))movement.push(`decks ${Number(source.deckChangePct)>=0?'+':''}${(100*Number(source.deckChangePct)).toFixed(0)}%`);if(Number(source.commanderRankChange||0))movement.push(`commander rank ${Number(source.commanderRankChange)>0?'+':''}${Number(source.commanderRankChange)}`);if(Number.isFinite(Number(source.commanderDeckChangePct)))movement.push(`commander decks ${Number(source.commanderDeckChangePct)>=0?'+':''}${(100*Number(source.commanderDeckChangePct)).toFixed(0)}%`);
      box.innerHTML=`<div class="cx-edhrec-head"><div><span class="cx-edhrec-kicker">Demand signal • EDHREC</span><strong>${esc(signal)}</strong></div><span class="cx-edhrec-score">${adj?`${adj>0?'+':''}${adj} Scout`:score?`${score}/100`:''}</span></div><div class="cx-edhrec-meta">${rank?`Weekly rank #${num(rank)}`:'EDHREC demand context'}${movement.length?` • ${esc(movement.join(' • '))}`:''}${source.observedAt?` • updated ${new Date(source.observedAt).toLocaleDateString()}`:''}</div><small>24h base ${Number(base).toFixed(1)} ${adj?`${adj>0?'+':''}${adj} demand adjustment`:''} → final Scout ${num(final)}. EDHREC is one demand source; other constructed-format signals can plug into the same demand layer later.</small>`;
      const thesis=detail.querySelector('.cx-thesis');if(thesis)thesis.insertAdjacentElement('afterend',box);else detail.appendChild(box);
    }catch{}
  }
  const mo=new MutationObserver(()=>queueMicrotask(refresh));
  function start(){const h=document.getElementById('cxParityDetail');if(!h)return false;mo.observe(h,{childList:true,subtree:true});refresh();return true}
  const root=new MutationObserver(()=>{if(!document.getElementById('cxParityDetail'))return;if(start())root.disconnect()});root.observe(document.documentElement,{childList:true,subtree:true});start();
})();