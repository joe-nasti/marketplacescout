import { rest } from '../../core/rest.js';

let installed=false,lastRows=[],lastOracle='';
const AUTO_CONFIRM_LIMIT=8;
const BATCH_LIMIT=25;

function stateOf(r){
  const raw=String(r?.coverage_state||'').trim().toLowerCase();
  if(raw.includes('catalog')||!r?.last_evaluated_at)return'catalog';
  if(raw.includes('current')||raw.includes('active')||raw.includes('fresh'))return'current';
  if(raw.includes('dormant')||raw.includes('stale'))return'dormant';
  const age=(Date.now()-new Date(r.last_evaluated_at).getTime())/86400000;
  return age<=7?'current':'dormant';
}
function refreshable(rows,mode='stale'){
  return (rows||[]).filter(r=>{
    const s=stateOf(r);
    if(mode==='catalog')return s==='catalog';
    if(mode==='dormant')return s==='dormant';
    return s==='catalog'||s==='dormant';
  });
}
function labelFor(mode,count,total){
  const scope=mode==='catalog'?'catalog-only':mode==='dormant'?'dormant':'stale';
  return count>total?`Refresh ${total} ${scope}`:`Refresh ${count} ${scope}`;
}
function style(){
  if(document.getElementById('cxOracleBulkRefreshStyle'))return;
  const s=document.createElement('style');s.id='cxOracleBulkRefreshStyle';s.textContent=`.cx-oracle-refresh-wrap{display:flex;gap:6px;align-items:center;margin-left:auto}.cx-oracle-refresh-wrap select,.cx-oracle-refresh-wrap button{border:1px solid var(--cx-border,#2a3440);background:var(--cx-surface,#111820);color:inherit;border-radius:8px;padding:5px 7px;font:inherit;font-size:11px}.cx-oracle-refresh-wrap button{font-weight:800;color:var(--cx-accent,#5aa2ff);cursor:pointer}.cx-oracle-refresh-wrap button[disabled]{opacity:.55;cursor:default}.cx-oracle-refresh-note{font-size:10px;opacity:.68}@media(max-width:760px){.cx-oracle-refresh-wrap{width:100%;margin-left:0}.cx-oracle-refresh-wrap button{flex:1}.cx-oracle-refresh-note{width:100%}}`;document.head.appendChild(s);
}
function controlsHost(){return document.querySelector('#cxUniversalResults .cx-oracle-controls')}
function updateControl(){
  const host=controlsHost();if(!host||!lastOracle)return;
  let wrap=host.querySelector('.cx-oracle-refresh-wrap');
  if(!wrap){wrap=document.createElement('span');wrap.className='cx-oracle-refresh-wrap';wrap.innerHTML='<select data-oracle-refresh-scope aria-label="Refresh scope"><option value="stale">Stale + catalog-only</option><option value="dormant">Dormant only</option><option value="catalog">Catalog-only</option></select><button type="button" data-oracle-bulk-refresh></button><span class="cx-oracle-refresh-note"></span>';host.appendChild(wrap);wrap.querySelector('[data-oracle-refresh-scope]')?.addEventListener('change',updateControl);wrap.querySelector('[data-oracle-bulk-refresh]')?.addEventListener('click',()=>void queueSelected())}
  const mode=wrap.querySelector('[data-oracle-refresh-scope]')?.value||'stale',eligible=refreshable(lastRows,mode),button=wrap.querySelector('[data-oracle-bulk-refresh]'),note=wrap.querySelector('.cx-oracle-refresh-note');
  const batch=Math.min(eligible.length,BATCH_LIMIT);if(button){button.disabled=!batch;button.textContent=batch?labelFor(mode,batch,eligible.length):'Nothing to refresh'}
  if(note)note.textContent=eligible.length>BATCH_LIMIT?`${eligible.length} eligible · max ${BATCH_LIMIT} per batch`:eligible.length?`${eligible.length} eligible one-off refresh${eligible.length===1?'':'es'}`:'All matching printings are current';
}
async function queueSelected(){
  const wrap=controlsHost()?.querySelector('.cx-oracle-refresh-wrap');if(!wrap)return;
  const mode=wrap.querySelector('[data-oracle-refresh-scope]')?.value||'stale',eligible=refreshable(lastRows,mode),batch=eligible.slice(0,BATCH_LIMIT);if(!batch.length)return;
  if(batch.length>AUTO_CONFIRM_LIMIT){
    const remainder=eligible.length-batch.length,extra=remainder>0?` ${remainder} more will remain for a later batch.`:'';
    if(!window.confirm(`Queue one-off Scout refreshes for ${batch.length} printings?${extra}`))return;
  }
  const button=wrap.querySelector('[data-oracle-bulk-refresh]'),note=wrap.querySelector('.cx-oracle-refresh-note');if(button){button.disabled=true;button.textContent='Queueing…'}
  let queued=0,already=0,failed=0;
  for(const r of batch){
    try{
      const out=await rest('rpc/request_scout_refresh',{method:'POST',body:{p_sku_id:r.sku_id,p_reason:'oracle_compare_bulk',p_priority:80}}),result=out?.[0]||{};
      if(result.already_open)already++;else queued++;
      r.refresh_requested_at=new Date().toISOString();
    }catch{failed++}
  }
  if(note)note.textContent=`${queued} queued${already?` · ${already} already queued`:''}${failed?` · ${failed} failed`:''}`;
  document.dispatchEvent(new CustomEvent('collectish:oracle-bulk-refresh-queued',{detail:{oracle:lastOracle,queued,already,failed,count:batch.length}}));
  setTimeout(updateControl,1200);
}
function acceptResults(e){
  const oracle=e.detail?.oracle;if(!oracle)return;lastOracle=String(oracle);lastRows=Array.isArray(e.detail.rows)?e.detail.rows:[];setTimeout(updateControl,0);
}
function clearIfNotOracle(){
  if(!new URL(location.href).searchParams.get('oracle')){lastOracle='';lastRows=[]}
}
export function installOracleBulkRefresh(){
  if(installed)return;installed=true;style();document.addEventListener('collectish:scout-universal-results',acceptResults);document.addEventListener('collectish:page-change',clearIfNotOracle);
}

installOracleBulkRefresh();