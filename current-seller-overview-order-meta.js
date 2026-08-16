// Collectish Seller overview order metadata — add fulfillment/status to Recent Orders cards.
(() => {
  let busy=false,queued=false;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function overviewTable(){
    const title=[...document.querySelectorAll('#cxSellerParityBody .cx-section-title')].find(x=>x.textContent.trim()==='Recent orders');
    return title?.parentElement?.querySelector('table')||null;
  }

  async function enrich(){
    if(busy){queued=true;return}
    const table=overviewTable();if(!table)return;
    const rows=[...table.querySelectorAll('tbody tr')].filter(r=>!r.querySelector('td[data-label="Fulfillment"]'));
    if(!rows.length)return;
    const ids=[...new Set(rows.map(r=>r.querySelector('td[data-label="Order"]')?.textContent.trim()).filter(Boolean))];
    if(!ids.length)return;
    busy=true;
    try{
      const data=await rest(`seller_orders?select=order_number,order_fulfillment,order_status&order_number=in.(${ids.map(encodeURIComponent).join(',')})`);
      const byId=new Map((data||[]).map(x=>[String(x.order_number),x]));
      for(const row of rows){
        const id=row.querySelector('td[data-label="Order"]')?.textContent.trim(),x=byId.get(String(id));if(!x)continue;
        const date=row.querySelector('td[data-label="Date"]');
        if(date&&!row.querySelector('td[data-label="Fulfillment"]')){
          const f=document.createElement('td');f.dataset.label='Fulfillment';f.innerHTML=esc(x.order_fulfillment||'—');date.insertAdjacentElement('afterend',f);
          const s=document.createElement('td');s.dataset.label='Status';s.innerHTML=esc(x.order_status||'—');f.insertAdjacentElement('afterend',s);
        }
      }
    }catch(e){console.warn('Seller overview metadata enrichment failed',e)}
    finally{busy=false;if(queued){queued=false;setTimeout(enrich,0)}}
  }

  const mo=new MutationObserver(()=>setTimeout(enrich,0));
  mo.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-seller-tab="overview"],[data-cx-page="seller"]'))setTimeout(enrich,80)},true);
  setTimeout(enrich,250);
})();
