const KEY='collectishSealedLanguageFilter';
let meta=new Map();
let metaLoading=null;
let lastMeta=0;
let observer=null;
let scheduled=0;

function classify(sc={}){
  const lang=String(sc.sealed_language||'English');
  const mode=String(sc.language_pricing_mode||'exact_or_default_english');
  const exact=Number(sc.exact_language_coverage_pct||0);
  const fallback=Number(sc.english_fallback_coverage_pct||0);
  if(mode==='english_equivalent_fallback'||fallback>0)return 'fallback';
  if(lang.toLowerCase()!=='english'&&exact>0)return 'nonenglish_exact';
  return 'english_exact';
}

async function loadMeta(force=false){
  if(!force&&meta.size&&Date.now()-lastMeta<60000)return meta;
  if(metaLoading)return metaLoading;
  metaLoading=(async()=>{
    try{
      if(typeof window.rest!=='function')return meta;
      const rows=await window.rest('sealed_ev_current?select=sealed_uuid,score_components&limit=5000');
      meta=new Map((rows||[]).map(r=>[String(r.sealed_uuid),r.score_components||{}]));
      lastMeta=Date.now();
    }catch(error){
      console.warn('sealed language metadata unavailable',error);
    }finally{
      metaLoading=null;
    }
    return meta;
  })();
  return metaLoading;
}

function removeOperationalTiles(){
  const detail=document.getElementById('cxSealedDetail');
  if(!detail)return;
  [...detail.querySelectorAll('.cx-sealed-stat')].forEach(el=>{
    const label=(el.querySelector('span')?.textContent||'').trim().toLowerCase();
    if(label==='lifecycle'||label==='components')el.remove();
  });
}

function ensureFilter(){
  const toolbar=document.querySelector('#cxSealed .cx-sealed-toolbar');
  if(!toolbar)return null;
  let select=document.getElementById('cxSealedLanguagePricing');
  if(select)return select;
  select=document.createElement('select');
  select.id='cxSealedLanguagePricing';
  select.innerHTML='<option value="all">All language pricing</option><option value="exclude_fallback">Exclude fallback pricing</option><option value="english_exact">English / exact-default only</option><option value="nonenglish_exact">Non-English exact-language only</option><option value="fallback">English fallback only</option>';
  select.value=localStorage.getItem(KEY)||'all';
  select.addEventListener('change',()=>{
    localStorage.setItem(KEY,select.value);
    applyLanguageFilter();
  });
  toolbar.appendChild(select);
  return select;
}

export function applyLanguageFilter(){
  const select=ensureFilter();
  if(!select)return;
  const mode=select.value||'all';
  let shown=0,hidden=0;
  document.querySelectorAll('#cxSealedRows [data-deck]').forEach(card=>{
    const cls=classify(meta.get(String(card.dataset.deck))||{});
    const visible=mode==='all'||(mode==='exclude_fallback'?cls!=='fallback':cls===mode);
    card.hidden=!visible;
    visible?shown++:hidden++;
  });
  let count=document.getElementById('cxSealedLanguageFilterCount');
  if(mode==='all'){
    count?.remove();
  }else{
    if(!count){
      count=document.createElement('small');
      count.id='cxSealedLanguageFilterCount';
      count.className='cx-sealed-language-filter-count';
      select.insertAdjacentElement('afterend',count);
    }
    count.textContent=`${shown} shown · ${hidden} hidden`;
  }
}

async function reconcile(forceMeta=false){
  const root=document.getElementById('cxSealed');
  if(!root?.querySelector('.cx-sealed-toolbar'))return;
  await loadMeta(forceMeta);
  ensureFilter();
  applyLanguageFilter();
  removeOperationalTiles();
}

function schedule(forceMeta=false,delay=0){
  clearTimeout(scheduled);
  scheduled=setTimeout(()=>reconcile(forceMeta).catch(()=>{}),delay);
}

function observeSealedRoot(){
  const root=document.getElementById('cxSealed');
  if(!root)return;
  observer?.disconnect();
  observer=new MutationObserver(()=>schedule(false,20));
  observer.observe(root,{childList:true,subtree:true});
}

export function installSealedUi(){
  document.addEventListener('collectish:lazy-page-loaded',event=>{
    if(event.detail?.page!=='sealed')return;
    observeSealedRoot();
    schedule(true,0);
  });
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#cxSealedRefresh,#cxSealedRetry'))schedule(true,180);
    else if(event.target.closest?.('[data-cx-page="sealed"]'))schedule(false,100);
    else if(event.target.closest?.('#cxSealedRows [data-deck]'))schedule(false,30);
  },true);
  document.addEventListener('collectish:ready',()=>{
    observeSealedRoot();
    schedule(false,250);
  });
}

installSealedUi();
