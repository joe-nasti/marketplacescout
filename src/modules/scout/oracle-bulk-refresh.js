import { rest } from '../../core/rest.js';
import { readOracleFamily, seedOracleFamily } from './oracle-family-data.js';

let installed=false,lastRows=[],lastOracle='',watchSeq=0,watchState=null;
const AUTO_CONFIRM_LIMIT=8;
const BATCH_LIMIT=25;
const FAMILY_LIMIT=2000;
const WATCH_DELAYS=[1500,2500,4000,6000,9000,12000,15000,20000,30000];

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
function stamp(v){const n=v?new Date(v).getTime():0;return Number.isFinite(n)?n:0}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function style(){
  if(document.getElementById('cxOracleBulkRefreshStyle'))return;
  const s=document.createElement('style');s.id='cxOracleBulkRefreshStyle';s.textContent=`.cx-oracle-refresh-wrap{display:flex;gap:6px;align-items:center;margin-left:auto}.cx-oracle-refresh-wrap select,.cx-oracle-refresh-wrap button{border:1px solid var(--cx-border,#2a3440);background:var(--cx-surface,#111820);color:inherit;border-radius:8px;padding:5px 7px;font:inherit;font-size:11px}.cx-oracle-refresh-wrap button{font-weight:800;color:var(--cx-accent,#5aa2ff);cursor:pointer}.cx-oracle-refresh-wrap button[disabled]{opacity:.55;cursor:default}.cx-oracle-refresh-note{font-size:10px;opacity:.68}.cx-oracle-refresh-note[data-live="done"]{color:#71d59a;opacity:.9}.cx-oracle-refresh-note[data-live="watching"]{color:var(--cx-accent,#5aa2ff);opacity:.9}@media(max-width:760px){.cx-oracle-refresh-wrap{width:100%;margin-left:0}.cx-oracle-refresh-wrap button{flex:1}.cx-oracle-refresh-note{width:100%}}`;document.head.appendChild(s);
}
function controlsHost(){return document.querySelector('#cxUniversalResults .cx-oracle-controls')}
function liveCopy(){
  if(!watchState||watchState.oracle!==lastOracle)return null;
  if(watchState.active)return{tone:'watching',text:`Refreshing… ${watchState.completed}/${watchState.total} complete · comparison updates automatically`};
  if(watchState.completed>=watchState.total)return{tone:'done',text:`${watchState.completed} refreshed · comparison updated`};
  return{tone:'',text:`${watchState.completed}/${watchState.total} refreshed · remaining scans are still processing`};
}
function updateControl(){
  const host=controlsHost();if(!host||!lastOracle)return;
  let wrap=host.querySelector('.cx-oracle-refresh-wrap');
  if(!wrap){wrap=document.createElement('span');wrap.className='cx-oracle-refresh-wrap';wrap.innerHTML='<select data-oracle-refresh-scope aria-label="Refresh scope"><option value="stale">Stale + catalog-only</option><option value="dormant">Dormant only</option><option value="catalog">Catalog-only</option></select><button type="button" data-oracle-bulk-refresh></button><span class="cx-oracle-refresh-note"></span>';host.appendChild(wrap);wrap.querySelector('[data-oracle-refresh-scope]')?.addEventListener('change',updateControl);wrap.querySelector('[data-oracle-bulk-refresh]')?.addEventListener('click',()=>void queueSelected())}
  const mode=wrap.querySelector('[data-oracle-refresh-scope]')?.value||'stale',eligible=refreshable(lastRows,mode),button=wrap.querySelector('[data-oracle-bulk-refresh]'),note=wrap.querySelector('.cx-oracle-refresh-note'),live=liveCopy();
  const batch=Math.min(eligible.length,BATCH_LIMIT);if(button){button.disabled=Boolean(watchState?.active)||!batch;button.textContent=watchState?.active?'Watching refresh…':batch?labelFor(mode,batch,eligible.length):'Nothing to refresh'}
  if(note){note.dataset.live=live?.tone||'';note.textContent=live?.text||(eligible.length>BATCH_LIMIT?`${eligible.length} eligible · max ${BATCH_LIMIT} per batch`:eligible.length?`${eligible.length} eligible one-off refresh${eligible.length===1?'':'es'}`:'All matching printings are current')}
}
function publishLive(rows,oracle,completed,total,done=false){
  lastRows=rows;
  seedOracleFamily(oracle,rows,{limit:FAMILY_LIMIT});
  const h=document.getElementById('cxUniversalResults');
  if(h){h._familyRows=rows;h._rows=new Map(rows.map(r=>[String(r.sku_id),r]))}
  document.dispatchEvent(new CustomEvent('collectish:oracle-family-live-update',{detail:{oracle,rows,completed,total,done}}));
  document.dispatchEvent(new CustomEvent('collectish:scout-universal-results',{detail:{count:rows.length,oracle,rows,capped:rows.length>=FAMILY_LIMIT,live:true}}));
  const p=new URL(location.href).searchParams,visible=h&&!h.hidden&&!p.get('oracleOpenSku');
  if(visible){const input=document.getElementById('cxParitySearch');if(input){clearTimeout(input._oracleLiveTimer);input._oracleLiveTimer=setTimeout(()=>input.dispatchEvent(new Event('input',{bubbles:true})),40)}}
}
async function watchRefreshes(oracle,watched,baseline){
  if(!watched.length)return;
  const token=++watchSeq,ids=new Set(watched.map(r=>String(r.sku_id)));watchState={oracle,total:ids.size,completed:0,active:true};updateControl();
  let lastCompleted=-1;
  for(const delay of WATCH_DELAYS){
    await sleep(delay);
    if(token!==watchSeq||oracle!==lastOracle||new URL(location.href).searchParams.get('oracle')!==oracle)return;
    try{
      const rows=await readOracleFamily(oracle,{limit:FAMILY_LIMIT,force:true}),bySku=new Map((rows||[]).map(r=>[String(r.sku_id),r]));
      let completed=0;
      for(const id of ids){const row=bySku.get(id);if(row&&stamp(row.last_evaluated_at)>Number(baseline[id]||0))completed++}
      watchState={oracle,total:ids.size,completed,active:completed<ids.size};
      if(completed!==lastCompleted){lastCompleted=completed;publishLive(rows||[],oracle,completed,ids.size,completed>=ids.size)}
      updateControl();
      if(completed>=ids.size){setTimeout(()=>{if(watchState?.oracle===oracle&&!watchState.active){watchState=null;updateControl()}},7000);return}
    }catch{}
  }
  if(token===watchSeq&&watchState?.oracle===oracle){watchState={...watchState,active:false};updateControl()}
}
async function queueSelected(){
  const wrap=controlsHost()?.querySelector('.cx-oracle-refresh-wrap');if(!wrap||watchState?.active)return;
  const mode=wrap.querySelector('[data-oracle-refresh-scope]')?.value||'stale',eligible=refreshable(lastRows,mode),batch=eligible.slice(0,BATCH_LIMIT);if(!batch.length)return;
  if(batch.length>AUTO_CONFIRM_LIMIT){
    const remainder=eligible.length-batch.length,extra=remainder>0?` ${remainder} more will remain for a later batch.`:'';
    if(!window.confirm(`Queue one-off Scout refreshes for ${batch.length} printings?${extra}`))return;
  }
  const button=wrap.querySelector('[data-oracle-bulk-refresh]'),note=wrap.querySelector('.cx-oracle-refresh-note');if(button){button.disabled=true;button.textContent='Queueing…'}
  const baseline=Object.fromEntries(batch.map(r=>[String(r.sku_id),stamp(r.last_evaluated_at)])),watched=[];
  let queued=0,already=0,failed=0;
  for(const r of batch){
    try{
      const out=await rest('rpc/request_scout_refresh',{method:'POST',body:{p_sku_id:r.sku_id,p_reason:'oracle_compare_bulk',p_priority:80}}),result=out?.[0]||{};
      if(result.already_open)already++;else queued++;
      watched.push(r);r.refresh_requested_at=new Date().toISOString();
    }catch{failed++}
  }
  if(note)note.textContent=`${queued} queued${already?` · ${already} already queued`:''}${failed?` · ${failed} failed`:''}`;
  const oracle=lastOracle;
  document.dispatchEvent(new CustomEvent('collectish:oracle-bulk-refresh-queued',{detail:{oracle,queued,already,failed,count:batch.length,watch_skus:watched.map(r=>String(r.sku_id))}}));
  if(watched.length)void watchRefreshes(oracle,watched,baseline);else setTimeout(updateControl,500);
}
function acceptResults(e){
  const oracle=e.detail?.oracle;if(!oracle)return;lastOracle=String(oracle);lastRows=Array.isArray(e.detail.rows)?e.detail.rows:[];setTimeout(updateControl,0);
}
function clearIfNotOracle(){
  if(!new URL(location.href).searchParams.get('oracle')){lastOracle='';lastRows=[];watchState=null;watchSeq++}
}
function refreshAfterFamilyBack(e){
  if(!e.target.closest?.('[data-oracle-detail-back]')||!lastOracle)return;
  setTimeout(()=>{const input=document.getElementById('cxParitySearch');if(input&&new URL(location.href).searchParams.get('oracle')===lastOracle)input.dispatchEvent(new Event('input',{bubbles:true}))},0);
}
export function installOracleBulkRefresh(){
  if(installed)return;installed=true;style();document.addEventListener('collectish:scout-universal-results',acceptResults);document.addEventListener('collectish:page-change',clearIfNotOracle);document.addEventListener('click',refreshAfterFamilyBack,true);
}

installOracleBulkRefresh();