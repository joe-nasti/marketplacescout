// Collectish Scout Sealed summary source actions r1001.
// Bind real TCGplayer anchors to the sealed title and acquisition tile after every detail render.
(() => {
  let seq=0;
  const cache=new Map();
  const selectedUuid=()=>document.querySelector('#cxSealedRows [data-deck].selected')?.dataset?.deck||'';

  async function tcgUrl(uuid){
    if(!uuid)return '';
    if(cache.has(uuid))return cache.get(uuid);
    const p=(async()=>{
      try{
        const rows=await rest(`sealed_ev_current?select=tcgplayer_product_id&sealed_uuid=eq.${encodeURIComponent(uuid)}&limit=1`);
        const id=rows?.[0]?.tcgplayer_product_id;
        return id?`https://www.tcgplayer.com/product/${encodeURIComponent(id)}?page=1`:'';
      }catch{return ''}
    })();
    cache.set(uuid,p);
    return p;
  }

  function overlay(el,url,label){
    if(!el||!url)return;
    const old=el.querySelector(':scope > .cx-sealed-summary-source-link');
    if(old&&old.href===url)return;
    old?.remove();
    el.style.position='relative';
    const a=document.createElement('a');
    a.className='cx-sealed-summary-source-link';
    a.href=url;
    a.target='_blank';
    a.rel='noopener';
    a.setAttribute('aria-label',label);
    a.dataset.noDetailSwipe='1';
    a.innerHTML='<span aria-hidden="true">↗</span>';
    a.addEventListener('click',e=>e.stopPropagation());
    a.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
    el.appendChild(a);
  }

  async function bind(){
    const my=++seq;
    const d=document.getElementById('cxSealedDetail');
    const uuid=selectedUuid();
    if(!d||!uuid||!d.querySelector('.cx-sealed-grid'))return;
    const url=await tcgUrl(uuid);
    if(my!==seq||selectedUuid()!==uuid||!url)return;

    overlay(d.querySelector('h3'),url,'Open sealed product on TCGplayer');
    for(const s of d.querySelectorAll('.cx-sealed-stat')){
      const label=(s.querySelector(':scope > span')?.textContent||'').trim().toLowerCase();
      if(label==='sealed acquisition')overlay(s,url,'Open sealed product on TCGplayer');
    }
  }

  let timer=0;
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>bind().catch(()=>{}),20)}
  const mo=new MutationObserver(schedule);
  function install(){
    mo.observe(document.documentElement,{subtree:true,childList:true});
    document.addEventListener('click',e=>{if(e.target.closest('#cxSealedRows [data-deck]'))setTimeout(schedule,80)},true);
    document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='sealed')setTimeout(schedule,80)});
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
