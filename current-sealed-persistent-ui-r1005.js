// Scout Sealed persistent UI fixes: survive renderer refresh/rebuilds.
(() => {
  const FILTER_KEY='collectishSealedLanguageFilter';
  let meta=new Map(), metaLoadedAt=0, raf=0;

  const classify=sc=>{
    sc=sc||{};
    const lang=String(sc.sealed_language||'English');
    const mode=String(sc.language_pricing_mode||'exact_or_default_english');
    const exact=Number(sc.exact_language_coverage_pct||0);
    const fallback=Number(sc.english_fallback_coverage_pct||0);
    if(mode==='english_equivalent_fallback'||fallback>0)return 'fallback';
    if(lang.toLowerCase()!=='english'&&exact>0)return 'nonenglish_exact';
    return 'english_exact';
  };

  async function loadMeta(force=false){
    if(!force&&Date.now()-metaLoadedAt<60000&&meta.size)return;
    const rows=await rest('sealed_ev_current?select=sealed_uuid,score_components&limit=5000').catch(()=>[]);
    meta=new Map((rows||[]).map(r=>[String(r.sealed_uuid),r.score_components||{}]));
    metaLoadedAt=Date.now();
  }

  function removeOperationalTiles(){
    const d=document.getElementById('cxSealedDetail');
    if(!d)return;
    [...d.querySelectorAll('.cx-sealed-stat')].forEach(s=>{
      const label=(s.querySelector('span')?.textContent||'').trim().toLowerCase();
      if(label==='lifecycle'||label==='components')s.remove();
    });
  }

  function ensureFilter(){
    const toolbar=document.querySelector('#cxSealed .cx-sealed-toolbar');
    if(!toolbar)return null;
    let s=document.getElementById('cxSealedLanguagePricing');
    if(!s){
      s=document.createElement('select');
      s.id='cxSealedLanguagePricing';
      s.innerHTML=`<option value="all">All language pricing</option><option value="exclude_fallback">Exclude fallback pricing</option><option value="english_exact">English / exact-default only</option><option value="nonenglish_exact">Non-English exact-language only</option><option value="fallback">English fallback only</option>`;
      s.value=localStorage.getItem(FILTER_KEY)||'all';
      s.addEventListener('change',()=>{localStorage.setItem(FILTER_KEY,s.value);applyFilter()});
      toolbar.appendChild(s);
    }
    return s;
  }

  function applyFilter(){
    const s=ensureFilter();
    if(!s)return;
    const mode=s.value||'all';
    let shown=0,hidden=0;
    document.querySelectorAll('#cxSealedRows [data-deck]').forEach(card=>{
      const cls=classify(meta.get(String(card.dataset.deck))||{});
      const ok=mode==='all'||(mode==='exclude_fallback'?cls!=='fallback':cls===mode);
      card.hidden=!ok;
      if(ok)shown++;else hidden++;
    });
    let n=document.getElementById('cxSealedLanguageFilterCount');
    if(mode==='all'){
      if(n)n.remove();
    }else{
      if(!n){n=document.createElement('small');n.id='cxSealedLanguageFilterCount';n.className='cx-sealed-language-filter-count';s.insertAdjacentElement('afterend',n)}
      n.textContent=`${shown} shown · ${hidden} hidden`;
    }
  }

  async function reconcile(forceMeta=false){
    const root=document.getElementById('cxSealed');
    if(!root)return;
    await loadMeta(forceMeta);
    ensureFilter();
    applyFilter();
    removeOperationalTiles();
  }

  function schedule(forceMeta=false){
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(()=>reconcile(forceMeta).catch(()=>{}));
  }

  const observer=new MutationObserver(()=>schedule(false));
  function install(){
    if(document.documentElement.dataset.cxSealedPersistentUi==='1'){schedule(true);return}
    document.documentElement.dataset.cxSealedPersistentUi='1';
    observer.observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='sealed')schedule(true)});
    document.addEventListener('click',e=>{
      if(e.target.closest('#cxSealedRefresh,#cxSealedRetry'))setTimeout(()=>schedule(true),150);
      else if(e.target.closest('#cxSealedRows [data-deck]'))setTimeout(()=>schedule(false),60);
    },true);
    schedule(true);
  }

  document.addEventListener('collectish:ready',install,{once:true});
  if(document.readyState!=='loading')install();
})();
