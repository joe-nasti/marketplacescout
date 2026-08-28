let installed=false,familyRows=[],familyOracle='',openedSku='',decorateSeq=0,familyConfidence=null;

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
function scoutScore(r){const v=r?.scout_score??r?.last_score??r?.promoted_score??r?.v5_shadow_score??r?.opportunity_score;return v==null?null:Number(v)}
function directRoi(r){const buy=Number(r?.cheapest_buy||r?.tcg_low||0),profit=Number(r?.direct_net_profit);return buy>0&&Number.isFinite(profit)?profit/buy*100:null}
function valueFor(r,key){if(key==='scout')return scoutScore(r);if(key==='buy')return Number(r?.cheapest_buy||r?.tcg_low||0)||null;if(key==='buylist')return Number(r?.buylist_roi_pct)||null;if(key==='direct')return directRoi(r);if(key==='velocity')return Number(r?.avg_daily_qty_sold)||null;return null}
function ranked(key,dir='max'){
  return familyRows.map(r=>({r,v:valueFor(r,key)})).filter(x=>x.v!=null&&Number.isFinite(Number(x.v))&&Number(x.v)!==0).sort((a,b)=>dir==='min'?Number(a.v)-Number(b.v):Number(b.v)-Number(a.v));
}
function confidenceQualifier(){
  if(!familyConfidence)return{prefix:'',note:''};
  const {label,score}=familyConfidence;
  if(label==='Low')return{prefix:'Current leader: ',note:`Family confidence is low (${score}%), so stale or unevaluated printings could change this result.`};
  return{prefix:'',note:`Family confidence is ${String(label).toLowerCase()} (${score}%).`};
}
function awardExplanations(row){
  const specs=[['scout','BEST SCOUT','max',v=>`${Math.round(v)}/100`],['buy','BEST BUY','min',money],['buylist','BEST BUYLIST ROI','max',v=>`${Number(v).toFixed(1)}%`],['direct','BEST DIRECT ROI','max',v=>`${Number(v).toFixed(1)}%`],['velocity','MOST LIQUID','max',v=>`${Number(v).toFixed(1)}/d`]];
  const out=[],q=confidenceQualifier();
  for(const [key,label,dir,fmt] of specs){
    const list=ranked(key,dir);if(!list.length||String(list[0].r.sku_id)!==String(row.sku_id))continue;
    const next=list[1],value=list[0].v;
    const reason=key==='scout'?`Highest Scout score in this Oracle family at ${fmt(value)}.`:key==='buy'?`Lowest acquisition price in the family at ${fmt(value)}.`:key==='buylist'?`Highest buylist return in the family at ${fmt(value)}.`:key==='direct'?`Highest estimated Direct ROI in the family at ${fmt(value)}.`:`Highest measured sales velocity in the family at ${fmt(value)}.`;
    out.push({label:q.prefix?`${q.prefix}${label.replace(/^BEST /,'').replace(/^MOST /,'')}`:label,reason:`${reason} ${q.note}`.trim(),next:next?`Next best: ${fmt(next.v)} · ${next.r.set_code||next.r.set_name||'printing'} ${next.r.collector_number?`#${next.r.collector_number}`:''}`.trim():''});
  }
  return out;
}
function ensureStyle(){
  if(document.getElementById('cxOracleDetailContextStyle'))return;
  const s=document.createElement('style');s.id='cxOracleDetailContextStyle';s.textContent=`.cx-oracle-detail-back{order:-1}.cx-oracle-win-explain{margin:10px 0;padding:10px;border:1px solid var(--cx-border,#2a3440);border-radius:10px;background:rgba(45,127,249,.06)}.cx-oracle-win-explain>strong{display:block;font-size:12px;margin-bottom:6px}.cx-oracle-win-confidence{display:block;margin:-2px 0 7px;font-size:10px;opacity:.7}.cx-oracle-win-item{padding:6px 0;border-top:1px solid rgba(127,127,127,.12)}.cx-oracle-win-item:first-of-type{border-top:0;padding-top:0}.cx-oracle-win-item b{font-size:10px;color:var(--cx-accent,#5aa2ff)}.cx-oracle-win-item span,.cx-oracle-win-item small{display:block;font-size:11px;margin-top:2px}.cx-oracle-win-item small{opacity:.65}`;document.head.appendChild(s);
}
function rowForSku(sku){return familyRows.find(r=>String(r?.sku_id)===String(sku))||null}
function familyName(){return new URL(location.href).searchParams.get('q')||'card'}
function backToFamily(){
  const detail=document.getElementById('cxUniversalDetail');if(detail)detail.innerHTML='';
  const results=document.getElementById('cxUniversalResults');if(results){results.hidden=false;results.scrollTop=0}
  openedSku='';const p=new URL(location.href).searchParams;p.delete('oracleOpenSku');history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
  document.getElementById('cxParitySearch')?.focus({preventScroll:true});
}
function decorateDetail(sku,token,attempt=0){
  if(token!==decorateSeq||String(openedSku)!==String(sku))return;
  const detail=document.querySelector('#cxUniversalDetail .cx-universal-detail');
  if(!detail){if(attempt<80)setTimeout(()=>decorateDetail(sku,token,attempt+1),100);return}
  const row=rowForSku(sku);if(!row)return;
  const actions=detail.querySelector('.cx-universal-actions');
  if(actions&&!actions.querySelector('[data-oracle-detail-back]')){const b=document.createElement('button');b.type='button';b.className='cx-oracle-detail-back';b.dataset.oracleDetailBack='1';b.textContent=`‹ Back to ${familyName()} printings`;b.addEventListener('click',backToFamily);actions.prepend(b)}
  detail.querySelector('.cx-oracle-win-explain')?.remove();
  const wins=awardExplanations(row);if(!wins.length)return;
  const conf=familyConfidence?`<small class="cx-oracle-win-confidence">${esc(familyConfidence.label)} family confidence · ${esc(familyConfidence.score)}%</small>`:'';
  const panel=document.createElement('div');panel.className='cx-oracle-win-explain';panel.innerHTML=`<strong>${familyConfidence?.label==='Low'?'Why this printing currently leads':'Why this printing wins'}</strong>${conf}${wins.map(w=>`<div class="cx-oracle-win-item"><b>${esc(w.label)}</b><span>${esc(w.reason)}</span>${w.next?`<small>${esc(w.next)}</small>`:''}</div>`).join('')}`;
  const note=detail.querySelector('.cx-universal-note');if(note)note.insertAdjacentElement('beforebegin',panel);else actions?.insertAdjacentElement('beforebegin',panel);
}
function onFamilyResults(e){const oracle=e.detail?.oracle;if(!oracle)return;familyOracle=String(oracle);familyRows=Array.isArray(e.detail.rows)?e.detail.rows:[]}
function onConfidence(e){if(!e.detail?.oracle||String(e.detail.oracle)!==String(familyOracle))return;familyConfidence={label:e.detail.label,score:e.detail.score};if(openedSku){const token=++decorateSeq;setTimeout(()=>decorateDetail(openedSku,token),0)}}
function onClick(e){
  const row=e.target.closest?.('[data-universal-sku]');if(!row)return;
  const p=new URL(location.href).searchParams,oracle=p.get('oracle');if(!oracle||!familyOracle||String(oracle)!==String(familyOracle))return;
  const sku=String(row.dataset.universalSku||'');if(!sku||!rowForSku(sku))return;
  openedSku=sku;p.set('oracleOpenSku',sku);history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);const token=++decorateSeq;setTimeout(()=>decorateDetail(sku,token),0);
}
function clearContext(){if(new URL(location.href).searchParams.get('oracle'))return;familyRows=[];familyOracle='';openedSku='';familyConfidence=null;decorateSeq++}
export function installOracleDetailContext(){
  if(installed)return;installed=true;ensureStyle();document.addEventListener('collectish:scout-universal-results',onFamilyResults);document.addEventListener('collectish:oracle-family-confidence',onConfidence);document.addEventListener('click',onClick);document.addEventListener('collectish:page-change',clearContext);
}

installOracleDetailContext();