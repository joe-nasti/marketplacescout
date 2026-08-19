// Scout Sealed language-pricing filter.
// Uses sealed_ev_current.score_components language metadata; does not infer from rendered text.
(() => {
  let meta=new Map(), installed=false;
  async function loadMeta(){
    const rows=await rest('sealed_ev_current?select=sealed_uuid,score_components&limit=5000').catch(()=>[]);
    meta=new Map((rows||[]).map(r=>[String(r.sealed_uuid),r.score_components||{}]));
  }
  function classify(sc={}){
    const lang=String(sc.sealed_language||'English');
    const mode=String(sc.language_pricing_mode||'exact_or_default_english');
    const exact=Number(sc.exact_language_coverage_pct||0);
    const fallback=Number(sc.english_fallback_coverage_pct||0);
    if(mode==='english_equivalent_fallback'||fallback>0)return 'fallback';
    if(lang.toLowerCase()!=='english'&&exact>0)return 'nonenglish_exact';
    return 'english_exact';
  }
  function ensureFilter(){
    const toolbar=document.querySelector('#cxSealed .cx-sealed-toolbar');
    if(!toolbar||document.getElementById('cxSealedLanguagePricing'))return;
    const s=document.createElement('select');
    s.id='cxSealedLanguagePricing';
    s.innerHTML=`
      <option value="all">All language pricing</option>
      <option value="exclude_fallback">Exclude fallback pricing</option>
      <option value="english_exact">English / exact-default only</option>
      <option value="nonenglish_exact">Non-English exact-language only</option>
      <option value="fallback">English fallback only</option>`;
    s.value=localStorage.getItem('collectishSealedLanguageFilter')||'all';
    s.addEventListener('change',()=>{localStorage.setItem('collectishSealedLanguageFilter',s.value);apply()});
    toolbar.appendChild(s);
  }
  function apply(){
    ensureFilter();
    const s=document.getElementById('cxSealedLanguagePricing');if(!s)return;
    const mode=s.value||'all';
    let shown=0,hidden=0;
    document.querySelectorAll('#cxSealedRows [data-deck]').forEach(card=>{
      const cls=classify(meta.get(String(card.dataset.deck))||{});
      const ok=mode==='all'||(mode==='exclude_fallback'?cls!=='fallback':cls===mode);
      card.hidden=!ok; if(ok)shown++; else hidden++;
    });
    const old=document.getElementById('cxSealedLanguageFilterCount');
    if(old)old.remove();
    if(mode!=='all'&&s.parentElement){
      const n=document.createElement('small');n.id='cxSealedLanguageFilterCount';n.className='cx-sealed-language-filter-count';n.textContent=`${shown} shown · ${hidden} hidden`;
      s.insertAdjacentElement('afterend',n);
    }
  }
  async function install(){
    if(installed)return;installed=true;
    await loadMeta();
    ensureFilter();apply();
    new MutationObserver(()=>{ensureFilter();apply()}).observe(document.getElementById('cxSealed')||document.body,{childList:true,subtree:true});
    document.addEventListener('collectish:lazy-page-loaded',async e=>{if(e.detail?.page==='sealed'){await loadMeta();ensureFilter();apply()}});
  }
  document.addEventListener('collectish:ready',()=>setTimeout(install,0),{once:true});
  if(document.readyState!=='loading')setTimeout(install,0);
})();
