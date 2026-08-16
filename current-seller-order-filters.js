// Collectish Seller order filters — business-facing Direct / Normal / Refunded filters.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>Number(n||0).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const date=v=>v?new Date(v).toLocaleDateString():'—';
  let debounce=0,seq=0;

  function table(headers,rows){return `<div class="cx-table-wrap"><table class="cx-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>`<td data-label="${esc(headers[i])}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}

  async function run(){
    const search=document.getElementById('cxSellerOrderSearch'),filter=document.getElementById('cxSellerOrderRefund'),host=document.getElementById('cxSellerOrdersTable');
    if(!search||!filter||!host)return;
    const token=++seq,q=search.value.trim(),f=filter.value;
    let path='seller_orders?select=order_number,order_date,order_status,order_channel,order_fulfillment,buyer_name,gross_amount,fee_amount,direct_fee_amount,net_amount,refund_total,review_rating,has_details&order=order_date.desc&limit=1000';
    if(q){const like=encodeURIComponent(`*${q}*`);path+=`&or=(order_number.ilike.${like},buyer_name.ilike.${like})`}
    if(f==='direct')path+='&order_fulfillment=eq.Direct';
    else if(f==='normal')path+='&order_fulfillment=eq.Normal';
    else if(f==='refunded')path+='&refund_total=gt.0';
    host.innerHTML='<div class="cx-empty">Loading orders…</div>';
    try{
      const rows=await rest(path);if(token!==seq)return;
      host.innerHTML=table(['Order','Date','Fulfillment','Buyer','Status','Gross','Fees','Refund','Net','Review'],(rows||[]).map(o=>[
        o.order_number,date(o.order_date),o.order_fulfillment||'',o.buyer_name||'',o.order_status||'',money(o.gross_amount),money(Number(o.fee_amount||0)+Number(o.direct_fee_amount||0)),money(o.refund_total),money(Number(o.net_amount||0)-Number(o.refund_total||0)),o.review_rating?`${o.review_rating}★`:''
      ]));
    }catch(e){if(token===seq)host.innerHTML=`<div class="cx-empty">${esc(e.message)}</div>`}
  }

  function install(){
    const filter=document.getElementById('cxSellerOrderRefund'),search=document.getElementById('cxSellerOrderSearch');
    if(!filter||!search||filter.dataset.cxBusinessFilters==='1')return;
    filter.dataset.cxBusinessFilters='1';
    const current=filter.value;
    filter.innerHTML='<option value="">All orders</option><option value="direct">Direct</option><option value="normal">Normal</option><option value="refunded">Refunded only</option>';
    if(['','direct','normal','refunded'].includes(current))filter.value=current;else filter.value='';
    filter.onchange=run;
    search.oninput=()=>{clearTimeout(debounce);debounce=setTimeout(run,250)};
  }

  const mo=new MutationObserver(()=>install());
  mo.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-seller-tab="orders"]'))setTimeout(install,50)},true);
  setTimeout(install,200);
})();
