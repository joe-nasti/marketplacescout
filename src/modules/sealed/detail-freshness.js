// Scout Sealed detail freshness + buyer-facing cleanup — resilient lazy-page binding.
(() => {
  const cache=new Map();
  const selectedUuid=()=>document.querySelector('#cxSealedRows [data-deck].selected')?.dataset?.deck||null;
  const fmt=d=>{if(!d)return '—';const dt=new Date(d);if(Number.isNaN(dt.getTime()))return String(d);const ageMs=Math.max(0,Date.now()-dt.getTime()),m=Math.round(ageMs/60000);const rel=m<60?(m<=1?'just now':`${m}m ago`):m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`;return `${rel} · ${dt.toLocaleString([], {month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})}`};
  const maxDate=vals=>{const ms=vals.filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);return ms.length?new Date(Math.max(...ms)).toISOString():null};
  async function load(uuid){if(cache.has(uuid))return cache.get(uuid);const p=(async()=>{const [contents,components,sealedPrice]=await Promise.all([rest(`mtgjson_sealed_products?select=source_updated_at&uuid=eq.${encodeURIComponent(uuid)}&limit=1`).catch(()=>[]),rest('rpc/get_sealed_component_economics',{method:'POST',body:{p_sealed_uuid:uuid}}).catch(()=>[]),rest(`sealed_product_price_current?select=captured_at&sealed_uuid=eq.${encodeURIComponent(uuid)}&order=captured_at.desc&limit=1`).catch(()=>[])]);const componentPriceDates=[];for(const c of components||[]){if(c.direct_observed_at)componentPriceDates.push(c.direct_observed_at);if(c.vendor_observed_on)componentPriceDates.push(`${c.vendor_observed_on}T12:00:00Z`)}return{prices:maxDate([sealedPrice?.[0]?.captured_at,...componentPriceDates]),contents:contents?.[0]?.source_updated_at||null}})();cache.set(uuid,p);return p}
  function cleanup(d){[...d.querySelectorAll('.cx-sealed-stat')].forEach(s=>{const label=(s.querySelector('span')?.textContent||'').trim().toLowerCase();if(label==='lifecycle'||label==='components')s.remove()})}
  async function decorate(){const d=document.getElementById('cxSealedDetail'),uuid=selectedUuid();if(!d||!uuid||!d.querySelector('.cx-sealed-grid'))return;cleanup(d);let strip=d.querySelector('.cx-sealed-freshness');if(!strip){strip=document.createElement('div');strip.className='cx-sealed-freshness';const badges=d.querySelector('.cx-sealed-badges');(badges?.parentNode||d).insertBefore(strip,badges?.nextSibling||d.firstChild)}strip.innerHTML='<span><b>Prices synced</b> …</span><span><b>Contents synced</b> …</span>';const x=await load(uuid);if(selectedUuid()!==uuid)return;strip.innerHTML=`<span><b>Prices synced</b> ${fmt(x.prices)}</span><span><b>Contents synced</b> ${fmt(x.contents)}</span>`}
  let timer=0;
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>decorate().catch(()=>{}),25)}
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',e=>{if(e.target.closest('#cxSealedRows [data-deck]')){cache.delete(selectedUuid());setTimeout(schedule,40);setTimeout(schedule,180)}},true);
  document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='sealed'){setTimeout(schedule,20);setTimeout(schedule,150);setTimeout(schedule,500)}});
  document.addEventListener('collectish:ready',()=>{setTimeout(schedule,20);setTimeout(schedule,250)});
  setTimeout(schedule,250);
})();