// Non-blocking Scout Sealed UI guardian. Event-driven; never participates in lazy loading.
(() => {
  const KEY='collectishSealedLanguageFilter';
  let meta=new Map(),metaLoading=false,lastMeta=0,observer=null,raf=0;
  const classify=sc=>{sc=sc||{};const lang=String(sc.sealed_language||'English'),mode=String(sc.language_pricing_mode||'exact_or_default_english'),exact=Number(sc.exact_language_coverage_pct||0),fallback=Number(sc.english_fallback_coverage_pct||0);if(mode==='english_equivalent_fallback'||fallback>0)return'fallback';if(lang.toLowerCase()!=='english'&&exact>0)return'nonenglish_exact';return'english_exact'};
  async function loadMeta(force=false){if(metaLoading||(!force&&Date.now()-lastMeta<60000&&meta.size))return;metaLoading=true;try{const rows=await rest('sealed_ev_current?select=sealed_uuid,score_components&limit=5000');meta=new Map((rows||[]).map(r=>[String(r.sealed_uuid),r.score_components||{}]));lastMeta=Date.now()}catch(e){console.warn('sealed language metadata unavailable',e)}finally{metaLoading=false}}
  function removeOps(){const d=document.getElementById('cxSealedDetail');if(!d)return;[...d.querySelectorAll('.cx-sealed-stat')].forEach(x=>{const t=(x.querySelector('span')?.textContent||'').trim().toLowerCase();if(t==='lifecycle'||t==='components')x.remove()})}
  function ensureFilter(){const tb=document.querySelector('#cxSealed .cx-sealed-toolbar');if(!tb)return null;let s=document.getElementById('cxSealedLanguagePricing');if(!s){s=document.createElement('select');s.id='cxSealedLanguagePricing';s.innerHTML='<option value="all">All language pricing</option><option value="exclude_fallback">Exclude fallback pricing</option><option value="english_exact">English / exact-default only</option><option value="nonenglish_exact">Non-English exact-language only</option><option value="fallback">English fallback only</option>';s.value=localStorage.getItem(KEY)||'all';s.onchange=()=>{localStorage.setItem(KEY,s.value);apply()};tb.appendChild(s)}return s}
  function apply(){const s=ensureFilter();if(!s)return;const mode=s.value||'all';let shown=0,hidden=0;document.querySelectorAll('#cxSealedRows [data-deck]').forEach(card=>{const cls=classify(meta.get(String(card.dataset.deck))||{}),ok=mode==='all'||(mode==='exclude_fallback'?cls!=='fallback':cls===mode);if(card.hidden===ok)card.hidden=!ok;ok?shown++:hidden++});let n=document.getElementById('cxSealedLanguageFilterCount');if(mode==='all'){n?.remove()}else{if(!n){n=document.createElement('small');n.id='cxSealedLanguageFilterCount';n.className='cx-sealed-language-filter-count';s.insertAdjacentElement('afterend',n)}const text=`${shown} shown · ${hidden} hidden`;if(n.textContent!==text)n.textContent=text}}
  function reconcile(){cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{ensureFilter();apply();removeOps()})}
  function attach(){const root=document.getElementById('cxSealed');if(!root)return;if(observer)return;observer=new MutationObserver(()=>reconcile());observer.observe(root,{childList:true,subtree:true});reconcile()}
  async function refresh(force=false){attach();await loadMeta(force);reconcile()}
  document.addEventListener('collectish:ready',()=>setTimeout(()=>refresh(true).catch(()=>{}),100));
  document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='sealed')refresh(true).catch(()=>{})});
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-cx-page="sealed"]'))setTimeout(()=>refresh(false).catch(()=>{}),80);
    if(e.target.closest('#cxSealedRefresh,#cxSealedRetry'))setTimeout(()=>refresh(true).catch(()=>{}),180);
  },true);
})();
