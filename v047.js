// Collectish Marketplace Scout web v0.4.7 — scan set release-date ordering
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion");if(badge)badge.textContent="web v0.4.7";
  const KEY="collectishScryfallSetReleaseDatesV1",MAX_AGE=30*86400000;
  let dates=null,scheduled=false;
  const norm=s=>String(s||"").trim().toLowerCase();
  function read(){try{return JSON.parse(localStorage.getItem(KEY)||"null")}catch{return null}}
  function write(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch{}}
  async function loadDates(){
    if(dates)return dates;
    const cached=read();
    if(cached?.items&&Date.now()-Number(cached.savedAt||0)<MAX_AGE){dates=cached.items;return dates}
    try{
      const r=await fetch("https://api.scryfall.com/sets",{headers:{"Accept":"application/json;q=0.9,*/*;q=0.8"}});
      if(!r.ok)throw Error(`Scryfall HTTP ${r.status}`);
      const d=await r.json(),items={};
      for(const s of d.data||[])if(s?.name)items[norm(s.name)]={releasedAt:s.released_at||null,code:s.code||null};
      dates=items;write({savedAt:Date.now(),items});return dates;
    }catch(e){console.warn("Set release-date lookup",e);dates=cached?.items||{};return dates}
  }
  function setName(option){return String(option.textContent||"").replace(/\s+\(\d[\d,]*\)\s*$/," ").trim()}
  function releaseFor(option){return dates?.[norm(setName(option))]?.releasedAt||null}
  function reorder(){
    const sel=el("newSet");if(!sel||!dates)return;
    const placeholder=[...sel.options].find(o=>!o.value)||null;
    const opts=[...sel.options].filter(o=>o.value),selected=sel.value;
    const desired=[...opts].sort((a,b)=>{
      const ad=releaseFor(a),bd=releaseFor(b),an=setName(a),bn=setName(b);
      if(ad&&bd&&ad!==bd)return bd.localeCompare(ad);
      if(ad&&!bd)return -1;if(!ad&&bd)return 1;
      return an.localeCompare(bn,undefined,{numeric:true});
    });
    const current=opts.map(o=>o.value).join("\u0001"),next=desired.map(o=>o.value).join("\u0001");
    if(current===next)return;
    const frag=document.createDocumentFragment();if(placeholder)frag.appendChild(placeholder);for(const o of desired){const d=releaseFor(o);if(d)o.dataset.releaseDate=d;frag.appendChild(o)}sel.appendChild(frag);sel.value=selected;
  }
  function schedule(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;reorder()},40)}
  async function init(){
    await loadDates();reorder();
    const sel=el("newSet");if(sel){new MutationObserver(schedule).observe(sel,{childList:true})}
    const status=el("setCacheStatus");if(status&&!document.getElementById("setReleaseOrderNote")){
      const note=document.createElement("div");note.id="setReleaseOrderNote";note.className="meta";note.textContent="Sets are ordered newest release first; unmatched dates appear last.";status.insertAdjacentElement("afterend",note);
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
