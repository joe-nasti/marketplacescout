// Scout Sealed summary actions r1000 — renderer-independent, resilient after detail re-renders.
(() => {
  const idForSelected=()=>document.querySelector('#cxSealedRows [data-deck].selected')?.dataset?.deck||'';
  const cache=new Map();
  async function getRow(uuid){
    if(cache.has(uuid)) return cache.get(uuid);
    const p=rest(`sealed_ev_current?select=sealed_uuid,tcgplayer_product_id&sealed_uuid=eq.${encodeURIComponent(uuid)}&limit=1`)
      .then(x=>(x||[])[0]||null).catch(()=>null);
    cache.set(uuid,p); return p;
  }
  function makeExternal(el,url,label){
    if(!el||!url||el.dataset.cxSummaryAction==='external')return;
    el.dataset.cxSummaryAction='external';
    el.classList.add('cx-sealed-summary-action','cx-sealed-summary-external');
    el.setAttribute('role','link');el.setAttribute('tabindex','0');el.setAttribute('aria-label',label||'Open source');
    const open=()=>window.open(url,'_blank','noopener');
    el.addEventListener('click',e=>{if(e.target.closest('a,button'))return;e.preventDefault();e.stopPropagation();open()});
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});
  }
  function makeJump(el,target,label){
    if(!el||!target||el.dataset.cxSummaryAction)return;
    el.dataset.cxSummaryAction='jump';
    el.classList.add('cx-sealed-summary-action','cx-sealed-summary-jump');
    el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label',label||'View component economics');
    const go=()=>target.scrollIntoView({behavior:'smooth',block:'start'});
    el.addEventListener('click',e=>{if(e.target.closest('a,button'))return;e.preventDefault();e.stopPropagation();go()});
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
  }
  async function decorate(){
    const d=document.getElementById('cxSealedDetail'),uuid=idForSelected();
    if(!d||!uuid||!d.querySelector('.cx-sealed-grid'))return;
    const row=await getRow(uuid);if(idForSelected()!==uuid)return;
    const tcgUrl=row?.tcgplayer_product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(row.tcgplayer_product_id)}?page=1`:'';
    if(tcgUrl){makeExternal(d.querySelector('h3'),tcgUrl,'Open sealed product on TCGplayer')}
    const econ=d.querySelector('.cx-sealed-econ-title');
    [...d.querySelectorAll('.cx-sealed-stat')].forEach(tile=>{
      const label=(tile.querySelector('span')?.textContent||'').trim().toLowerCase();
      if(label==='sealed acquisition'&&tcgUrl)makeExternal(tile,tcgUrl,'Open sealed product on TCGplayer');
      else if(['tcg market ev','ck buylist floor','market spread','components'].includes(label))makeJump(tile,econ,'View component economics');
    });
  }
  let timer=0;const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>decorate().catch(()=>{}),40)};
  const mo=new MutationObserver(schedule);
  function install(){mo.observe(document.documentElement,{childList:true,subtree:true});document.addEventListener('click',e=>{if(e.target.closest('#cxSealedRows [data-deck]'))setTimeout(schedule,80)},true);schedule()}
  document.addEventListener('collectish:ready',install,{once:true});if(document.readyState!=='loading')install();
})();
