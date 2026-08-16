// Collectish Seller detail polish — mobile financial grid + TCGplayer item links.
(() => {
  const openExternal=url=>{
    try{if(window.CollectishAndroid?.openExternal){window.CollectishAndroid.openExternal(url);return}}catch{}
    window.open(url,'_blank','noopener,noreferrer');
  };
  const tcgSearch=name=>`https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(name)}&view=grid`;
  const currentOrder=()=>{
    const h=document.querySelector('#cxSellerDrillBody .cx-seller-drill-head h3')?.textContent||'';
    return h.replace(/^Order\s+/i,'').trim();
  };
  const isItemRow=row=>{
    const wrap=row?.closest('.cx-table-wrap');
    const heading=wrap?.previousElementSibling;
    return /^Items\s*\(/i.test(heading?.textContent?.trim()||'');
  };
  document.addEventListener('click',async e=>{
    const row=e.target.closest?.('#cxSellerDrilldown .cx-table tbody tr');
    if(!row||!isItemRow(row))return;
    const order=currentOrder();
    const product=row.querySelector('td')?.textContent?.trim()||'';
    if(!order||!product)return;
    e.preventDefault();
    row.classList.add('cx-item-opening');
    try{
      const rows=await rest(`seller_order_items?select=product_id,sku_id,product_name&order_number=eq.${encodeURIComponent(order)}&product_name=eq.${encodeURIComponent(product)}&limit=1`);
      const id=rows?.[0]?.product_id;
      openExternal(id?`https://www.tcgplayer.com/product/${encodeURIComponent(id)}`:tcgSearch(product));
    }catch{
      openExternal(tcgSearch(product));
    }finally{row.classList.remove('cx-item-opening')}
  },true);

  const style=document.createElement('style');
  style.textContent=`
    #cxSellerDrilldown .cx-table tbody tr{cursor:pointer}
    #cxSellerDrilldown .cx-table tbody tr.cx-item-opening{opacity:.6}
    @media(max-width:980px){
      #cxSellerDrilldown .cx-order-flow{grid-template-columns:repeat(3,minmax(0,1fr))!important;overflow:visible!important;gap:7px!important}
      #cxSellerDrilldown .cx-order-flow-step{min-width:0!important;width:auto!important}
    }
    @media(max-width:430px){
      #cxSellerDrilldown .cx-order-flow{gap:6px!important}
      #cxSellerDrilldown .cx-order-flow-step{padding:9px 8px!important}
      #cxSellerDrilldown .cx-order-flow-step strong{font-size:13px!important}
      #cxSellerDrilldown .cx-order-flow-step.net strong{font-size:15px!important}
    }
  `;
  document.head.appendChild(style);
})();
