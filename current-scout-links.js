// Scout external card links — render from the visible detail panel, with no database lookup dependency
(() => {
  let seq=0,scheduled=false;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const suffixes=['borderless','showcase','extended art','retro frame','surge foil','galaxy foil','serialized','foil etched','etched','alternate art','halo foil','rainbow foil'];
  function baseName(name=''){
    let s=String(name).trim();
    for(;;){const m=s.match(/^(.*)\s+\(([^()]*)\)$/);if(!m||!suffixes.some(x=>m[2].toLowerCase().includes(x)))break;s=m[1].trim()}
    return s;
  }
  function edhSlug(name=''){
    return baseName(name).normalize('NFKD').replace(/[’‘]/g,"'").toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }
  function ensureLinks(detail,name){
    let box=detail.querySelector('.cx-scout-external-links');
    if(!box){box=document.createElement('div');box.className='cx-scout-external-links';const scry=detail.querySelector('a.cx-scout-link[href*="scryfall.com"]');if(scry)scry.insertAdjacentElement('beforebegin',box);else detail.appendChild(box)}
    const edh=`https://edhrec.com/cards/${encodeURIComponent(edhSlug(name))}`;
    box.innerHTML=`<a class="cx-scout-link cx-edhrec-link" target="_blank" rel="noopener" href="${esc(edh)}">Open on EDHREC</a>`;
    return box;
  }
  async function addTcgFromScryfall(detail,box,token){
    const scry=detail.querySelector('a.cx-scout-link[href*="scryfall.com"]');if(!scry)return;
    try{
      const u=new URL(scry.href),parts=u.pathname.split('/').filter(Boolean);
      let api=null;
      if(parts[0]==='card'&&parts.length>=3)api=`https://api.scryfall.com/cards/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
      if(!api)return;
      const res=await fetch(api);if(!res.ok)return;const card=await res.json();if(token!==seq)return;
      const id=card.tcgplayer_id||card.tcgplayer_etched_id;if(!id)return;
      const tcg=`https://www.tcgplayer.com/product/${encodeURIComponent(id)}?direct=true&page=1`;
      box.insertAdjacentHTML('afterbegin',`<a class="cx-scout-link cx-tcgplayer-link" target="_blank" rel="noopener" href="${esc(tcg)}">Open on TCGplayer</a>`);
    }catch{}
  }
  async function refresh(){
    scheduled=false;
    const detail=document.getElementById('cxParityDetail');if(!detail)return;
    const title=detail.querySelector('.cx-detail-title .cx-section-title');if(!title)return;
    const name=title.textContent.trim();if(!name)return;
    const token=++seq,box=ensureLinks(detail,name);
    await addTcgFromScryfall(detail,box,token);
  }
  function schedule(){if(scheduled)return;scheduled=true;setTimeout(refresh,0)}
  const mo=new MutationObserver(schedule);
  function start(){const h=document.getElementById('cxParityDetail');if(!h)return false;mo.observe(h,{childList:true,subtree:true});schedule();return true}
  const root=new MutationObserver(()=>{if(start())root.disconnect()});
  root.observe(document.documentElement,{childList:true,subtree:true});start();
})();
