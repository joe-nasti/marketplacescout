import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n)>=0?'+':''}${Number(n).toFixed(1)}%`;
let byUuid=new Map(),loadedAt=0,loading=null,applying=false;

async function loadData(force=false){
  if(!force&&Date.now()-loadedAt<60000&&byUuid.size)return byUuid;
  if(loading)return loading;
  loading=(async()=>{
    const rows=await rest('sealed_product_price_current?select=sealed_uuid,captured_at,raw_json&source=eq.cardtrader&limit=1000').catch(()=>[]);
    byUuid=new Map((rows||[]).map(r=>[String(r.sealed_uuid),{...r,sourcing:r.raw_json?.ct_zero_sourcing||{},trend:r.raw_json?.ct_zero_trend||{},zero:r.raw_json?.ct_zero||{}}]));
    loadedAt=Date.now();loading=null;return byUuid;
  })();
  return loading;
}
function ensureControls(){
  const select=document.getElementById('cxSealedFilter');if(!select)return;
  const legacy=select.querySelector('option[value="ct0opps"]');if(legacy)legacy.textContent='CT0 sourcing candidates';
  else select.insertAdjacentHTML('beforeend','<option value="ct0opps">CT0 sourcing candidates</option>');
  const tight=select.querySelector('option[value="ct0tightening"]');if(!tight)select.insertAdjacentHTML('beforeend','<option value="ct0tightening">CT0 tightening candidates</option>');
  if(!document.getElementById('cxCt0OpportunityCount'))select.insertAdjacentHTML('afterend','<small id="cxCt0OpportunityCount" class="cx-sub"></small>');
  const status=store.get().sealed?.filters?.status||'';if(['ct0opps','ct0tightening'].includes(status))select.value=status;
}
function addBadge(node,data){
  const host=node.querySelector('.cx-sealed-badges');if(!host)return;
  host.querySelectorAll('[data-ct0-opportunity-badge]').forEach(x=>x.remove());
  const s=data?.sourcing||{},t=data?.trend||{};
  if(s.candidate){const b=document.createElement('span');b.dataset.ct0OpportunityBadge='';b.className='cx-sealed-badge buylist';b.textContent=`CT0 WATCH ${pct(s.comparison_spread_pct)}`;host.appendChild(b)}
  if(['tightening','strong_tightening'].includes(t.signal)){const b=document.createElement('span');b.dataset.ct0OpportunityBadge='';b.className='cx-sealed-badge syp';b.textContent=t.signal==='strong_tightening'?'CT0 TIGHT ↑↑':'CT0 TIGHT ↑';host.appendChild(b)}
}
function eligible(data,mode){const s=data?.sourcing||{},t=data?.trend||{};if(mode==='ct0opps')return s.candidate===true;if(mode==='ct0tightening')return s.candidate===true&&['tightening','strong_tightening'].includes(t.signal);return true}
function rank(data){const s=data?.sourcing||{},spread=Number(s.comparison_spread_pct),qty=Number(s.zero_quantity);return (Number.isFinite(spread)?spread:0)+(Number.isFinite(qty)?Math.min(qty,24)/12:0)}
async function apply(){
  if(applying)return;applying=true;
  try{
    await loadData();ensureControls();
    const container=document.getElementById('cxSealedRows');if(!container)return;
    const mode=store.get().sealed?.filters?.status||'';
    const nodes=[...container.querySelectorAll('[data-deck]')];
    for(const node of nodes){const d=byUuid.get(String(node.dataset.deck));addBadge(node,d);node.hidden=!eligible(d,mode)}
    if(['ct0opps','ct0tightening'].includes(mode)){
      const visible=nodes.filter(n=>!n.hidden).sort((a,b)=>rank(byUuid.get(String(b.dataset.deck)))-rank(byUuid.get(String(a.dataset.deck))));
      for(const node of visible)container.appendChild(node);
      const count=document.getElementById('cxCt0OpportunityCount');if(count)count.textContent=`${visible.length} CT0 ${mode==='ct0tightening'?'tightening ':''}sourcing candidates · comparison only until executable exit + lead time are known`;
      const selected=String(store.get().sealed?.selectedId||''),first=visible[0]?.dataset.deck;
      if(first&&!visible.some(n=>String(n.dataset.deck)===selected))setTimeout(()=>window.CollectishSealed?.select?.(first),0);
    }else{
      for(const node of nodes)node.hidden=false;
      const count=document.getElementById('cxCt0OpportunityCount');if(count)count.textContent='';
    }
  }finally{applying=false}
}

document.addEventListener('collectish:sealed-rendered',()=>{apply().catch(()=>{})});
window.addEventListener('focus',()=>{if(Date.now()-loadedAt>60000){loadData(true).then(()=>apply()).catch(()=>{})}});
