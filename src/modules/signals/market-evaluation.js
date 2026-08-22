import { rest } from '../../core/rest.js';

let lastRefresh=0;
let inFlight=null;
let evaluations=[];

const pct=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`:'';
const cls=stage=>stage==='early'?'leading':stage==='confirming'?'confirming':stage==='late'?'lagging':'unclassified';
const label=stage=>stage==='insufficient_data'?'INSUFFICIENT DATA':String(stage||'').toUpperCase();

function detail(v){
  if(!v)return'';
  const bits=[];
  if(v.pre_price_change_pct!=null)bits.push(`Market ${pct(v.pre_price_change_pct)} pre-pub`);
  if(v.pre_qty_change_pct!=null)bits.push(`Direct qty ${pct(-Number(v.pre_qty_change_pct))} pre-pub`);
  if(v.pre_rank_improvement_pct!=null)bits.push(`rank ${pct(v.pre_rank_improvement_pct)} improvement`);
  return bits.slice(0,2).join(' · ');
}

function decorate(){
  document.querySelectorAll('.cx-signal-card[data-intel-id]').forEach(card=>{
    card.querySelectorAll('[data-market-evaluation]').forEach(x=>x.remove());
    const intelId=card.dataset.intelId;
    const rows=evaluations.filter(x=>x.intel_id===intelId);
    if(!rows.length)return;
    const head=card.querySelector('.cx-signal-card-head');
    if(!head)return;
    for(const v of rows){
      const chip=document.createElement('span');
      chip.dataset.marketEvaluation='1';
      chip.className=`cx-signal-stage ${cls(v.market_stage)}`;
      chip.textContent=`MARKET ${label(v.market_stage)}`;
      chip.title=[v.reason,detail(v)].filter(Boolean).join(' · ');
      head.appendChild(chip);
    }
    const best=rows.find(x=>x.market_stage!=='insufficient_data')||rows[0];
    const d=detail(best);
    if(d){
      const meta=card.querySelector('.cx-signal-meta');
      if(meta){
        const line=document.createElement('div');
        line.dataset.marketEvaluation='1';
        line.className='cx-signal-meta';
        line.textContent=`MarketplaceScout: ${d}`;
        meta.insertAdjacentElement('afterend',line);
      }
    }
  });
}

async function refresh({force=false}={}){
  if(inFlight)return inFlight;
  if(!force&&Date.now()-lastRefresh<60000){decorate();return evaluations}
  inFlight=(async()=>{
    try{
      await rest('rpc/refresh_market_intel_evaluations',{method:'POST',body:{}});
      const data=await rest('market_intel_evaluations?select=*&order=evaluated_at.desc&limit=500');
      evaluations=Array.isArray(data)?data:[];
      lastRefresh=Date.now();
      decorate();
      document.dispatchEvent(new CustomEvent('collectish:intel-evaluated',{detail:{count:evaluations.length}}));
      return evaluations;
    }catch(error){
      console.warn('Market-intel evaluation refresh failed',error);
      return evaluations;
    }finally{inFlight=null}
  })();
  return inFlight;
}

document.addEventListener('collectish:intel-changed',()=>void refresh({force:true}));
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>void refresh())});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>void refresh({force:true}))});

export { refresh as refreshIntelMarketEvaluations };
