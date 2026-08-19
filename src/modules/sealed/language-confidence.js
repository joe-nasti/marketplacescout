// Scout Sealed language-confidence presentation.
(() => {
  function meta(r){const s=r?.score_components||{};return {lang:s.sealed_language||'English',mode:s.language_pricing_mode||'',exact:Number(s.exact_language_coverage_pct||0),fallback:Number(s.english_fallback_coverage_pct||0),penalty:Number(s.language_confidence_penalty||0),raw:s.language_raw_score==null?null:Number(s.language_raw_score)}}
  function label(m){if(!m||m.lang==='English')return '';const short=m.lang==='Japanese'?'JP':m.lang.slice(0,2).toUpperCase();return `${short} · EN fallback ${m.fallback.toFixed(0)}%`}
  function decorateList(){
    const api=window.CollectishLazyDataPages; // presence only; renderer owns data
    document.querySelectorAll('#cxSealedRows [data-deck]').forEach(el=>{
      if(el.querySelector('.cx-sealed-lang-badge'))return;
      const title=el.querySelector('.cx-sealed-name strong')?.textContent||'';
      const mLang=/\b(Japanese|German|French|Italian|Spanish|Portuguese|Korean|Chinese)\b/i.exec(title)?.[1];
      if(!mLang)return;
      const badges=el.querySelector('.cx-sealed-badges');if(!badges)return;
      const b=document.createElement('span');b.className='cx-sealed-badge cx-sealed-lang-badge risk';b.textContent=`${mLang==='Japanese'?'JP':mLang.slice(0,2).toUpperCase()} · fallback`;badges.appendChild(b);
    });
  }
  async function decorateDetail(){
    const d=document.getElementById('cxSealedDetail');if(!d||!d.querySelector('.cx-sealed-econ'))return;
    const selected=document.querySelector('#cxSealedRows [data-deck].selected');const uuid=selected?.dataset?.deck;if(!uuid)return;
    if(d.dataset.cxLangUuid===uuid)return;
    const rows=await rest(`sealed_ev_current?select=product_name,score_components,scout_sealed_score,scout_sealed_grade&sealed_uuid=eq.${encodeURIComponent(uuid)}&limit=1`).catch(()=>[]);const r=rows?.[0];if(!r)return;
    const m=meta(r);d.dataset.cxLangUuid=uuid;if(m.lang==='English')return;
    const anchor=d.querySelector('.cx-sealed-badges');if(!anchor)return;
    const box=document.createElement('div');box.className='cx-sealed-language-note';box.innerHTML=`<strong>${m.lang} sealed product</strong><span>Component EV is currently priced from the English-equivalent printing where exact ${m.lang} pricing is unavailable.</span><small>Exact ${m.lang} coverage ${m.exact.toFixed(0)}% · English fallback ${m.fallback.toFixed(0)}%${m.penalty?` · confidence −${m.penalty.toFixed(0)} pts`:''}${m.raw!=null?` · raw score ${m.raw.toFixed(1)}`:''}</small>`;anchor.insertAdjacentElement('afterend',box);
  }
  let raf=0;const schedule=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{decorateList();decorateDetail().catch(()=>{})})};
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='sealed')setTimeout(schedule,80)});
  document.addEventListener('collectish:ready',schedule,{once:true});
  schedule();
})();
