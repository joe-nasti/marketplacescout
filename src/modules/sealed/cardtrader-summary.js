import { rest } from '../../core/rest.js';

const DISMISS_KEY='collectishCt0SummaryDismissed';
let loading=false,lastAt=0;
const dismissed=()=>sessionStorage.getItem(DISMISS_KEY)==='1';
function ensure(){
  const root=document.getElementById('cxSealed');if(!root)return null;
  let bar=document.getElementById('cxCt0Summary');
  if(dismissed()){bar?.remove();return null}
  if(!bar){
    bar=document.createElement('div');bar.id='cxCt0Summary';bar.className='cx-sealed-summary cx-ct0-summary-pill';
    const toolbar=root.querySelector('.cx-sealed-toolbar');if(toolbar)toolbar.after(bar);else root.prepend(bar);
  }
  return bar;
}
async function load(force=false){
  if(loading||(!force&&Date.now()-lastAt<60000))return;
  const bar=ensure();if(!bar)return;
  loading=true;
  try{
    const rows=await rest('sealed_product_price_current?select=sealed_uuid,raw_json,captured_at&source=eq.cardtrader&limit=1000').catch(()=>[]);
    const ct=rows||[],candidates=ct.filter(x=>x.raw_json?.ct_zero_sourcing?.candidate===true),tight=candidates.filter(x=>['tightening','strong_tightening'].includes(x.raw_json?.ct_zero_trend?.signal)),stocked=ct.filter(x=>Number(x.raw_json?.ct_zero?.quantity||0)>0),landedComplete=ct.filter(x=>x.raw_json?.landed_model?.version==='ct0_us_v2'&&x.raw_json?.landed_model?.complete===true),last=ct.map(x=>x.captured_at).filter(Boolean).sort().at(-1)||null;
    bar.innerHTML=`<span class="cx-ct0-pill-copy"><strong>CT0 sourcing</strong><span>${candidates.length} watch candidates${tight.length?` · ${tight.length} tightening`:''} · ${stocked.length} stocked · ${landedComplete.length} landed-ready</span>${last?`<small>${new Date(last).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</small>`:''}</span><button type="button" class="cx-ct0-pill-action" data-ct0-summary-action="opps">View</button><button type="button" class="cx-ct0-pill-dismiss" data-ct0-dismiss aria-label="Dismiss CardTrader Zero sourcing summary">×</button>`;
    lastAt=Date.now();
  }finally{loading=false}
}
function setMode(mode){const select=document.getElementById('cxSealedFilter');if(!select)return;select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}))}
document.addEventListener('collectish:sealed-rendered',()=>load().catch(()=>{}));
document.addEventListener('click',e=>{
  const dismiss=e.target.closest?.('[data-ct0-dismiss]');
  if(dismiss){sessionStorage.setItem(DISMISS_KEY,'1');document.getElementById('cxCt0Summary')?.remove();return}
  const b=e.target.closest?.('[data-ct0-summary-action]');if(!b)return;
  setMode(b.dataset.ct0SummaryAction==='tight'?'ct0tightening':'ct0opps');
});
window.addEventListener('focus',()=>load(true).catch(()=>{}));
window.CollectishCt0Summary={refresh:()=>load(true)};
