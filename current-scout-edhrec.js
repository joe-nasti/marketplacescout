// Collectish Scout EDHREC context renderer
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
      const rows=await rest(`marketplace_scan_rows?select=edhrec_rank,edhrec_signal,edhrec_signal_score,commander_demand_score,edhrec_observed_at&product_name=eq.${encodeURIComponent(name)}&edhrec_signal=not.is.null&order=id.desc&limit=1`);
      if(token!==seq||lastName!==name||!rows?.[0])return;
      const r=rows[0],box=document.createElement('div');box.className=`cx-edhrec-context cx-edhrec-${String(r.edhrec_signal||'').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;
      const rank=Number(r.edhrec_rank||0),score=Number(r.edhrec_signal_score??r.commander_demand_score??0);
      box.innerHTML=`<div class="cx-edhrec-head"><div><span class="cx-edhrec-kicker">Commander context</span><strong>${esc(r.edhrec_signal||'EDHREC')}</strong></div><span class="cx-edhrec-score">${score?`${score}/100`:''}</span></div><div class="cx-edhrec-meta">${rank?`Weekly EDHREC rank #${num(rank)}`:'Independent EDHREC signal'}${r.edhrec_observed_at?` • updated ${new Date(r.edhrec_observed_at).toLocaleDateString()}`:''}</div><small>This is independent demand/reprint context and does not change the core Scout grade.</small>`;
      const thesis=detail.querySelector('.cx-thesis');if(thesis)thesis.insertAdjacentElement('afterend',box);else detail.appendChild(box);
    }catch{}
  }
  const mo=new MutationObserver(()=>queueMicrotask(refresh));
  function start(){const h=document.getElementById('cxParityDetail');if(!h)return false;mo.observe(h,{childList:true,subtree:true});refresh();return true}
  const root=new MutationObserver(()=>{if(!document.getElementById('cxParityDetail'))return;if(start())root.disconnect()});root.observe(document.documentElement,{childList:true,subtree:true});start();
})();