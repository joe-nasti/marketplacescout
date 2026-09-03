import {rest} from '../../core/rest.js';

const esc=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=value=>value==null?'—':Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const number=value=>value==null?'—':Number(value).toLocaleString();
const age=value=>{const ms=Date.now()-new Date(value).getTime(),h=Math.max(0,ms/36e5);return h<1?`${Math.round(h*60)}m ago`:h<48?`${Math.round(h)}h ago`:`${Math.round(h/24)}d ago`};
let request=0;

function row(label,value,sub=''){
  return `<div class="cx-vendor-depth-row"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
}

function render(data){
  const current=Array.isArray(data?.current)?data.current:[];
  const ckRetail=current.filter(x=>x.source==='cardkingdom'&&x.lane==='retail_supply');
  const ckBuy=current.find(x=>x.source==='cardkingdom'&&x.lane==='buylist_demand');
  const mana=current.filter(x=>x.source==='manapool'&&x.lane==='retail_supply');
  const threshold=current.find(x=>x.source==='manapool'&&x.lane==='threshold_supply'&&Number(x.threshold_price)===Number(ckBuy?.price));
  const ckCopies=ckRetail.reduce((n,x)=>n+Number(x.quantity||0),0);
  const conditionSupply=ckRetail.filter(x=>Number(x.quantity)>0).map(x=>`${x.condition} ${number(x.quantity)} @ ${money(x.price)}`).join(' · ')||'Out of stock';
  const manaCopies=mana.reduce((n,x)=>n+Number(x.quantity||0),0);
  const updated=current.map(x=>x.observed_at).filter(Boolean).sort().at(-1);
  const rows=[
    row('CK retail supply',`${number(ckCopies)} copies`,conditionSupply),
    row('CK buylist demand',ckBuy?`${number(ckBuy.quantity)} copies @ ${money(ckBuy.price)}`:'Not currently buying','Remaining acceptance · condition not exposed'),
    row('Mana Pool supply',mana.length?`${number(manaCopies)} copies`:'Not measured',mana.filter(x=>Number(x.quantity)>0).map(x=>`${x.condition} ${number(x.quantity)} @ ${money(x.price)}`).join(' · ')),
    row('Mana Pool ≤ CK bid',threshold?`${number(threshold.listing_count)} listings · ${number(threshold.quantity)} copies`:'Targeted probe pending',threshold?`${threshold.count_quality.replaceAll('_',' ')} · threshold ${money(threshold.threshold_price)}`:'Requires Mana Pool buyer API credentials')
  ].join('');
  return `<section class="cx-v5-section cx-vendor-depth"><div class="cx-section-title">Inventory & buylist depth</div><p class="cx-sub">Exact printing. Counts retain their source scope; CK retail stock is not buylist demand.</p><div class="cx-vendor-depth-grid">${rows}</div>${updated?`<small class="cx-vendor-depth-fresh">Observed ${esc(age(updated))}</small>`:''}</section>`;
}

async function decorate(event){
  const host=document.getElementById('cxParityDetail'),row=event.detail?.row;
  host?.querySelector('.cx-vendor-depth')?.remove();
  if(!host||!row?.mtgjson_uuid)return;
  const seq=++request;
  try{
    const data=await rest('rpc/vendor_depth_for_printing_v1',{method:'POST',body:{p_mtgjson_uuid:row.mtgjson_uuid,p_finish:String(row.printing||'').toLowerCase().includes('foil')?'foil':'nonfoil',p_language:'EN',p_history_days:30}});
    if(seq!==request||!document.getElementById('cxParityDetail'))return;
    const section=document.createRange().createContextualFragment(render(data)).firstElementChild;
    const anchor=host.querySelector('.cx-scout-market-board')||host.querySelector('.cx-scout-why-buy');
    if(anchor)anchor.insertAdjacentElement('afterend',section);else host.appendChild(section);
  }catch(error){console.warn('Vendor depth unavailable',error)}
}

const style=document.createElement('style');style.textContent=`.cx-vendor-depth-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}.cx-vendor-depth-row{border:1px solid var(--cx-line);border-radius:10px;padding:8px;background:var(--cx-bg)}.cx-vendor-depth-row>span,.cx-vendor-depth-row>small{display:block;font-size:10px;color:var(--cx-muted)}.cx-vendor-depth-row>strong{display:block;margin:2px 0}.cx-vendor-depth-fresh{display:block;color:var(--cx-muted);margin-top:7px}@media(max-width:520px){.cx-vendor-depth-grid{grid-template-columns:1fr}}`;document.head.appendChild(style);
document.addEventListener('collectish:scout-detail-rendered',event=>void decorate(event));

