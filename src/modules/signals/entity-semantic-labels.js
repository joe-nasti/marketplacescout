import store from '../../state/store.js';

const lower=s=>String(s||'').trim().toLowerCase();
const labelFor=type=>({card:'Card',format:'Format',set:'Set',sealed_product:'Product',retailer:'Retailer',other:'Context'}[type]||'Context');

function decorate(){
  const items=store.get().intel?.items||[];
  document.querySelectorAll('#cxSignalsFeed .cx-signal-card').forEach(card=>{
    const item=items.find(x=>String(x.intel_id)===String(card.dataset.intelId));
    const entities=Array.isArray(item?.market_intel_entities)?item.market_intel_entities:[];
    const spans=[...card.querySelectorAll('.cx-signal-entities span')];
    spans.forEach((span,i)=>{
      const entity=entities[i];if(!entity)return;
      const verifiedCard=entity.entity_type==='card'&&!!(entity.scryfall_id||entity.product_id);
      const raw=String(entity.entity_name||span.textContent||'').replace(/\s*✓\s*$/,'').trim();
      const typeLabel=verifiedCard?'Card':labelFor(entity.entity_type);
      span.dataset.entityType=entity.entity_type||'other';
      span.dataset.verifiedCard=verifiedCard?'1':'0';
      span.textContent=`${typeLabel} · ${raw}${verifiedCard?' ✓':''}`;
      span.title=verifiedCard?'Verified Magic card — opens in Scout':`${typeLabel} context — not a Scout card link`;
      span.setAttribute('aria-label',span.title);
    });
  });
}

const schedule=()=>setTimeout(decorate,0);
document.addEventListener('collectish:intel-changed',schedule);
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(decorate,80)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(decorate,100)});
document.addEventListener('collectish:idle-modules-ready',schedule,{once:true});
queueMicrotask(decorate);
