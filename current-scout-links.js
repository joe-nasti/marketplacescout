// Scout external card links — TCGplayer / EDHREC / Scryfall
(() => {
  let seq=0,lastName='';
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const suffixes=['borderless','showcase','extended art','retro frame','surge foil','galaxy foil','serialized','foil etched','etched','alternate art','halo foil','rainbow foil'];
  function baseName(name=''){
    let s=String(name).trim();
    for(;;){
      const m=s.match(/^(.*)\s+\(([^()]*)\)$/);
      if(!m||!suffixes.some(x=>m[2].toLowerCase().includes(x)))break;
      s=m[1].trim();
    }
    return s;
  }
  function edhSlug(name=''){
    return baseName(name).normalize('NFKD').replace(/[’‘]/g,"'").toLowerCase()
      .replace(/['’]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }
  function tcgUrl(r){
    if(!r?.product_id)return null;
    const q=new URLSearchParams();
    if(r.printing)q.set('Printing',r.printing);
    if(r.condition)q.set('Condition',r.condition);
    if(r.language)q.set('Language',r.language);
    q.set('direct','true');q.set('page','1');
    return `https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?${q.toString()}`;
  }
  async function refresh(){
    const detail=document.getElementById('cxParityDetail');if(!detail)return;
    const title=detail.querySelector('.cx-detail-title .cx-section-title');if(!title)return;
    const name=title.textContent.trim();if(!name)return;
    const token=++seq;lastName=name;
    detail.querySelector('.cx-scout-external-links')?.remove();
    try{
      const rows=await rest(`scout_opportunities_24h?select=product_id,product_name,printing,condition,language&product_name=eq.${encodeURIComponent(name)}&order=opportunity_score.desc&limit=1`);
      if(token!==seq||lastName!==name)return;
      const r=rows?.[0]||{product_name:name};
      const tcg=tcgUrl(r),edh=`https://edhrec.com/cards/${encodeURIComponent(edhSlug(r.product_name||name))}`;
      const scry=detail.querySelector('a.cx-scout-link[href*="scryfall.com"]');
      const links=document.createElement('div');links.className='cx-scout-external-links';
      links.innerHTML=`${tcg?`<a class="cx-scout-link" target="_blank" rel="noopener" href="${esc(tcg)}">Open on TCGplayer</a>`:''}<a class="cx-scout-link" target="_blank" rel="noopener" href="${esc(edh)}">Open on EDHREC</a>`;
      if(scry)scry.insertAdjacentElement('beforebegin',links);else detail.appendChild(links);
    }catch{}
  }
  const mo=new MutationObserver(()=>queueMicrotask(refresh));
  function start(){const h=document.getElementById('cxParityDetail');if(!h)return false;mo.observe(h,{childList:true,subtree:true});refresh();return true}
  const root=new MutationObserver(()=>{if(document.getElementById('cxParityDetail')&&start())root.disconnect()});
  root.observe(document.documentElement,{childList:true,subtree:true});start();
})();
