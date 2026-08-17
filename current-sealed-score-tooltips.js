// Scout Sealed score tooltips — explain component points inline.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;
  const money=n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const scoreLabels=new Set(['Economics','Exit floor','Execution','Data confidence','Concentration','Bulk efficiency']);
  let tip=null,seq=0;
  const selectedDeck=()=>document.querySelector('#cxSealedRows .cx-sealed-row.selected')?.dataset.deck||'';
  function close(){tip?.remove();tip=null}
  function row(label,value){return `<div class="cx-score-tip-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`}
  function build(label,ev){
    const c=ev.score_components||{};
    if(label==='Economics')return {points:`${Number(c.economics||0).toFixed(1)} / 40`,desc:'Executable upside versus the sealed acquisition price.',rows:[['Sealed acquisition',money(ev.sealed_acquisition_price)],['Direct live ROI',pct(ev.direct_roi_pct)],['SYP-adjusted ROI',pct(ev.syp_roi_pct)],['CK buylist ROI',pct(ev.buylist_roi_pct)],['How it scores','Direct + buylist support weigh most; SYP upside is discounted']]};
    if(label==='Exit floor')return {points:`${Number(c.exit_floor||0).toFixed(1)} / 20`,desc:'Cash support if the deck is cracked and liquidated through CK.',rows:[['Sealed acquisition',money(ev.sealed_acquisition_price)],['CK buylist EV',money(ev.cardkingdom_buylist_ev)],['CK buylist ROI',pct(ev.buylist_roi_pct)],['Buylist value coverage',pct(ev.buylist_value_coverage_pct)],['How it scores','Higher cash-floor coverage versus buy price earns more points']]};
    if(label==='Execution')return {points:`${Number(c.execution||0).toFixed(1)} / 15`,desc:'How much of the EV can realistically flow through Direct today or via SYP.',rows:[['Direct value coverage',pct(ev.direct_value_coverage_pct)],['Direct + SYP coverage',pct(ev.syp_value_coverage_pct)],['Direct live net EV',money(ev.direct_live_net_ev)],['SYP-adjusted net EV',money(ev.syp_adjusted_direct_net_ev)],['SYP eligible cards',String(ev.syp_eligible_cards??0)]]};
    if(label==='Data confidence')return {points:`${Number(c.confidence||0).toFixed(1)} / 10`,desc:'How much of the deck’s value is supported by observed pricing rather than missing data.',rows:[['Market value coverage',pct(ev.market_value_coverage_pct)],['Buylist value coverage',pct(ev.buylist_value_coverage_pct)],['Direct value coverage',pct(ev.direct_value_coverage_pct)],['Direct + SYP coverage',pct(ev.syp_value_coverage_pct)],['How it scores','Value-weighted coverage matters more than raw card count']]};
    if(label==='Concentration')return {points:`${Number(c.concentration||0).toFixed(1)} / 10`,desc:'Whether EV is concentrated in useful, sellable cards without depending on only one or two hits.',rows:[['Top 5 share of Market EV',pct(ev.top5_market_pct)],['Top 10 share of Market EV',pct(ev.top10_market_pct)],['Cards ≥ $2',String(ev.cards_ge_2??0)],['Cards ≥ $5',String(ev.cards_ge_5??0)],['How it scores','Useful concentration is rewarded; extreme dependence is penalized']]};
    if(label==='Bulk efficiency')return {points:`${Number(c.bulk_efficiency||0).toFixed(1)} / 5`,desc:'How much operational drag comes from low-value cards.',rows:[['Cards below $1',String(ev.bulk_cards_lt_1??0)],['Cards ≥ $2',String(ev.cards_ge_2??0)],['Cards ≥ $5',String(ev.cards_ge_5??0)],['How it scores','More sub-$1 cards means more sorting/listing/shipping friction and fewer points']]};
    return null;
  }
  async function openFor(stat,label){
    close();const deck=selectedDeck();if(!deck)return;const my=++seq;
    const r=stat.getBoundingClientRect();tip=document.createElement('div');tip.className='cx-score-tooltip';tip.innerHTML='<div class="cx-empty">Loading score details…</div>';document.body.append(tip);
    const place=()=>{if(!tip)return;const w=Math.min(360,window.innerWidth-24),left=Math.max(12,Math.min(window.innerWidth-w-12,r.left)),below=r.bottom+8,above=r.top-tip.offsetHeight-8,top=below+tip.offsetHeight<window.innerHeight-8?below:Math.max(12,above);tip.style.width=`${w}px`;tip.style.left=`${left}px`;tip.style.top=`${top}px`};place();
    try{const rows=await rest(`precon_ev_current?select=*&deck_key=eq.${encodeURIComponent(deck)}&limit=1`);if(my!==seq||!tip)return;const x=build(label,rows?.[0]||{});if(!x){close();return}tip.innerHTML=`<button type="button" class="cx-score-tip-close" aria-label="Close score tooltip">×</button><strong>${esc(label)} · ${esc(x.points)}</strong><p>${esc(x.desc)}</p><div>${x.rows.map(([a,b])=>row(a,b)).join('')}</div>`;tip.querySelector('.cx-score-tip-close').onclick=e=>{e.stopPropagation();close()};place()}catch(e){if(tip)tip.innerHTML=`<div class="cx-empty">${esc(e.message||e)}</div>`}
  }
  document.addEventListener('click',e=>{
    const stat=e.target.closest('#cxSealedDetail .cx-sealed-stat');if(!stat)return;const label=stat.querySelector('span')?.textContent?.trim()||'';if(!scoreLabels.has(label))return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();openFor(stat,label);
  },true);
  document.addEventListener('click',e=>{if(tip&&!e.target.closest('.cx-score-tooltip'))close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&tip){e.stopPropagation();close()}});
  window.addEventListener('resize',close);window.addEventListener('scroll',close,true);
})();
