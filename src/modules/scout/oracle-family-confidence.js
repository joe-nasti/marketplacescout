let installed=false,lastRows=[],lastOracle='';

function stateOf(r){
  const explicit=String(r?.coverage_state||'').trim().toLowerCase();
  if(explicit.includes('catalog')||!r?.last_evaluated_at)return'catalog';
  if(explicit.includes('current')||explicit.includes('active')||explicit.includes('fresh'))return'current';
  if(explicit.includes('dormant')||explicit.includes('stale'))return'dormant';
  return (Date.now()-new Date(r.last_evaluated_at).getTime())/86400000<=7?'current':'dormant';
}
function counts(rows){
  const out={current:0,dormant:0,catalog:0,total:(rows||[]).length};
  for(const r of rows||[])out[stateOf(r)]++;
  return out;
}
function confidence(rows){
  const c=counts(rows);if(!c.total)return{...c,score:0,label:'Low',tone:'low',explanation:'No Oracle-family printings are available to evaluate yet.'};
  const score=Math.round(((c.current)+(c.dormant*.5))/c.total*100);
  const label=score>=80?'High':score>=50?'Medium':'Low';
  const tone=label.toLowerCase();
  let explanation='Most printings are current, so cross-printing recommendations have strong coverage.';
  if(label==='Medium')explanation='The family has useful coverage, but stale or unevaluated printings could still change the winner.';
  if(label==='Low')explanation='Too much of the family is stale or unevaluated to treat the current winner as fully settled.';
  return{...c,score,label,tone,explanation};
}
function ensureStyle(){
  if(document.getElementById('cxOracleConfidenceStyle'))return;
  const s=document.createElement('style');s.id='cxOracleConfidenceStyle';s.textContent=`.cx-oracle-confidence{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 12px;align-items:center;margin:10px 0 0;padding:9px 10px;border:1px solid var(--cx-line,var(--cx-border,#2a3440));border-radius:10px;background:rgba(127,127,127,.05)}.cx-oracle-confidence-score{min-width:72px}.cx-oracle-confidence-score span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:var(--cx-muted);font-weight:800}.cx-oracle-confidence-score strong{display:block;font-size:18px;line-height:1.1}.cx-oracle-confidence-copy b{display:block;font-size:11px}.cx-oracle-confidence-copy small{display:block;margin-top:2px;color:var(--cx-muted);font-size:10px;line-height:1.35}.cx-oracle-confidence-bar{grid-column:1/-1;height:5px;border-radius:999px;background:rgba(127,127,127,.16);overflow:hidden}.cx-oracle-confidence-bar i{display:block;height:100%;background:var(--cx-accent,#5aa2ff);border-radius:999px}.cx-oracle-confidence[data-tone="low"] .cx-oracle-confidence-score strong{opacity:.72}.cx-oracle-confidence[data-tone="medium"] .cx-oracle-confidence-score strong{opacity:.88}.cx-oracle-badge[data-confidence="low"]{background:rgba(127,127,127,.12);color:var(--cx-muted,#9aa8b6)}.cx-oracle-badge[data-confidence="medium"]{background:rgba(228,184,96,.14);color:#e4b860}.cx-oracle-badge[data-confidence="high"]{background:rgba(113,213,154,.12);color:#71d59a}@media(max-width:520px){.cx-oracle-confidence{grid-template-columns:1fr}.cx-oracle-confidence-bar{grid-column:1}.cx-oracle-confidence-score{display:flex;gap:8px;align-items:baseline}.cx-oracle-confidence-score span,.cx-oracle-confidence-score strong{display:inline}}`;document.head.appendChild(s);
}
function decorateAwards(c){
  document.querySelectorAll('#cxUniversalResults .cx-oracle-badge').forEach(b=>{
    if(!b.dataset.baseAward)b.dataset.baseAward=b.textContent.trim();
    const base=b.dataset.baseAward;b.dataset.confidence=c.tone;
    b.textContent=c.tone==='low'?`${base.replace(/^BEST /,'').replace(/^MOST /,'')} · CURRENT LEADER`:`${base} · ${c.label.toUpperCase()} CONFIDENCE`;
    b.title=c.tone==='low'?`Current leader only: family confidence is ${c.score}%. Stale or unevaluated printings could change this result.`:`${c.label} family confidence (${c.score}%).`;
  });
}
function render(){
  const panel=document.getElementById('cxOracleCompareSummary');
  if(!panel||!lastOracle||new URL(location.href).searchParams.get('oracle')!==lastOracle)return;
  panel.querySelector('.cx-oracle-confidence')?.remove();
  const c=confidence(lastRows),el=document.createElement('div');el.className='cx-oracle-confidence';el.dataset.tone=c.tone;
  el.innerHTML=`<div class="cx-oracle-confidence-score"><span>Family confidence</span><strong>${c.score}% · ${c.label}</strong></div><div class="cx-oracle-confidence-copy"><b>${c.current} current · ${c.dormant} dormant · ${c.catalog} catalog-only</b><small>${c.explanation} Current printings count fully; dormant printings receive half credit; catalog-only printings receive no credit until evaluated.</small></div><div class="cx-oracle-confidence-bar" aria-label="Oracle family confidence ${c.score} percent"><i style="width:${c.score}%"></i></div>`;
  panel.appendChild(el);decorateAwards(c);
  document.dispatchEvent(new CustomEvent('collectish:oracle-family-confidence',{detail:{oracle:lastOracle,...c}}));
}
function acceptResults(e){
  if(!e.detail?.oracle)return;lastOracle=String(e.detail.oracle);lastRows=Array.isArray(e.detail.rows)?e.detail.rows:[];setTimeout(render,30);
}
function refresh(){if(lastOracle)setTimeout(render,0)}
function clear(){if(!new URL(location.href).searchParams.get('oracle')){lastOracle='';lastRows=[]}}
export function installOracleFamilyConfidence(){
  if(installed)return;installed=true;ensureStyle();document.addEventListener('collectish:scout-universal-results',acceptResults);document.addEventListener('collectish:scout-list-rendered',refresh);document.addEventListener('collectish:oracle-bulk-refresh-queued',refresh);document.addEventListener('collectish:page-change',clear);
}

installOracleFamilyConfidence();