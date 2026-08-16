// Collectish Seller drilldowns — delegated click-to-detail for orders, payments and RI invoices.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const num=n=>Number(n||0).toLocaleString();
  const date=v=>v?new Date(v).toLocaleString():'—';
  let seq=0;

  function ensure(){
    let d=document.getElementById('cxSellerDrilldown');
    if(d)return d;
    d=document.createElement('div');d.id='cxSellerDrilldown';d.className='cx-seller-drill';
    d.innerHTML='<div class="cx-seller-drill-backdrop" data-close></div><section class="cx-seller-drill-panel"><button class="cx-seller-drill-close" data-close aria-label="Close">×</button><div id="cxSellerDrillBody"></div></section>';
    document.body.appendChild(d);
    d.addEventListener('click',e=>{if(e.target.closest('[data-close]'))close()});
    return d;
  }
  function open(html){const d=ensure();document.getElementById('cxSellerDrillBody').innerHTML=html;d.classList.add('open');document.body.classList.add('cx-seller-drill-open')}
  function close(){document.getElementById('cxSellerDrilldown')?.classList.remove('open');document.body.classList.remove('cx-seller-drill-open')}
  const loading=t=>`<div class="cx-seller-drill-head"><h3>${esc(t)}</h3></div><div class="cx-empty">Loading…</div>`;
  const stat=(k,v)=>`<div class="cx-seller-drill-stat"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`;
  function miniTable(headers,rows){return `<div class="cx-table-wrap"><table class="cx-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>`<td data-label="${esc(headers[i])}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}

  async function showOrder(orderNumber){
    const my=++seq;open(loading(`Order ${orderNumber}`));
    try{
      const [o,i,r,v]=await Promise.all([
        rest(`seller_orders?select=*&order_number=eq.${encodeURIComponent(orderNumber)}&limit=1`),
        rest(`seller_order_items?select=product_name,product_id,sku_id,quantity,unit_price,listing_price,extended_price,order_fulfillment&order_number=eq.${encodeURIComponent(orderNumber)}&order=product_name.asc`),
        rest(`seller_refunds?select=created_at_source,amount,shipping_amount,origin,reason,reason_text,type&order_number=eq.${encodeURIComponent(orderNumber)}&order=created_at_source.desc`),
        rest(`seller_reviews?select=rating,review_text,created_at_source&order_number=eq.${encodeURIComponent(orderNumber)}&limit=1`)
      ]);if(my!==seq)return;
      const x=o?.[0]||{};
      open(`<div class="cx-seller-drill-head"><h3>Order ${esc(orderNumber)}</h3><p>${esc(x.order_status||'')} ${x.order_fulfillment?'• '+esc(x.order_fulfillment):''}</p></div>
        <div class="cx-seller-drill-stats">${stat('Date',date(x.order_date))}${stat('Buyer',x.buyer_name||'—')}${stat('Gross',money(x.gross_amount))}${stat('Fees',money(Number(x.fee_amount||0)+Number(x.direct_fee_amount||0)))}${stat('Refunds',money(x.refund_total))}${stat('Net',money(Number(x.net_amount||0)-Number(x.refund_total||0)))}</div>
        <h4>Items (${num(i?.length)})</h4>${i?.length?miniTable(['Product','Qty','Unit','Extended'],i.map(y=>[y.product_name||`SKU ${y.sku_id||''}`,num(y.quantity),money(y.unit_price??y.listing_price),money(y.extended_price)])):'<div class="cx-empty">Order item detail has not been backfilled yet.</div>'}
        <h4>Refunds</h4>${r?.length?miniTable(['Date','Amount','Origin','Type','Reason'],r.map(y=>[date(y.created_at_source),money(Number(y.amount||0)+Number(y.shipping_amount||0)),y.origin||'',y.type||'',y.reason_text||y.reason||''])):'<div class="cx-empty">No refunds.</div>'}
        <h4>Review</h4>${v?.[0]?`<div class="cx-card"><strong>${Number(v[0].rating||0)}★</strong><p>${esc(v[0].review_text||'')}</p><small>${esc(date(v[0].created_at_source))}</small></div>`:'<div class="cx-empty">No review.</div>'}`);
    }catch(e){if(my===seq)open(`<div class="cx-empty">${esc(e.message)}</div>`)}
  }

  async function showPayment(paymentId){
    const my=++seq;open(loading(`Payment ${paymentId}`));
    try{
      const [p,o,a]=await Promise.all([
        rest(`seller_payments?select=*&payment_id=eq.${encodeURIComponent(paymentId)}&limit=1`),
        rest(`seller_payment_orders?select=order_number,channel,buyer_name,order_date,total_sale,total_fees,refunded_orders,refunded_fees&payment_id=eq.${encodeURIComponent(paymentId)}&order=order_date.desc&limit=5000`),
        rest(`seller_payment_adjustments?select=amount,reason,order_number,ri_number,collected_at&payment_id=eq.${encodeURIComponent(paymentId)}&order=collected_at.desc&limit=1000`)
      ]);if(my!==seq)return;const x=p?.[0]||{};
      open(`<div class="cx-seller-drill-head"><h3>Payment ${esc(paymentId)}</h3><p>${x.is_pending?'Pending':'Completed / scheduled'}</p></div>
        <div class="cx-seller-drill-stats">${stat('Arrival',date(x.arrival_date))}${stat('Orders',num(x.order_count))}${stat('Sales',money(x.total_sales))}${stat('Fees',money(x.total_fees))}${stat('Refunds',money(Number(x.refunded_orders||0)+Number(x.refunded_fees||0)))}${stat('Adjustments',money(x.adjustments))}${stat('Payment',money(x.payment))}</div>
        <h4>Orders in payment (${num(o?.length)})</h4>${o?.length?miniTable(['Order','Date','Buyer','Sale','Fees','Refund'],o.map(y=>[y.order_number,date(y.order_date),y.buyer_name||'',money(y.total_sale),money(y.total_fees),money(Number(y.refunded_orders||0)+Number(y.refunded_fees||0))])):'<div class="cx-empty">No linked orders stored for this payment.</div>'}
        <h4>Adjustments</h4>${a?.length?miniTable(['Date','Reason','Amount','Order / RI'],a.map(y=>[date(y.collected_at),y.reason||'',money(y.amount),y.order_number||y.ri_number||''])):'<div class="cx-empty">No adjustments.</div>'}`);
    }catch(e){if(my===seq)open(`<div class="cx-empty">${esc(e.message)}</div>`)}
  }

  async function showRI(riNumber){
    const my=++seq;open(loading(`RI ${riNumber}`));
    try{
      const [ri,d]=await Promise.all([
        rest(`reimbursement_invoices?select=*&ri_number=eq.${encodeURIComponent(riNumber)}&limit=1`),
        rest(`ri_discrepancies?select=set_name,product_name,expected_condition,received_condition,quantity,discrepancy,discrepancy_reason,market_price,sold_price,replacement_fee&ri_number=eq.${encodeURIComponent(riNumber)}&order=product_name.asc&limit=5000`)
      ]);if(my!==seq)return;const x=ri?.[0]||{};
      const total=Number(x.total_product_count||0),known=d?.length||0;
      open(`<div class="cx-seller-drill-head"><h3>${esc(riNumber)}</h3><p>${esc(x.status||'')}</p></div>
        <div class="cx-seller-drill-stats">${stat('Created',date(x.created_date))}${stat('Products',num(total))}${stat('Product value',money(x.total_product_value))}${stat('Replacement fees',money(x.total_replacement_fees))}${stat('Discrepancy rows',num(x.discrepancy_row_count))}${stat('Tracking',x.tracking_number||'—')}</div>
        <h4>Discrepancy products (${num(known)})</h4>${known?miniTable(['Product','Set','Expected','Received','Qty Δ','Reason','Replacement'],d.map(y=>[y.product_name||'',y.set_name||'',y.expected_condition||'',y.received_condition||'',num(y.discrepancy),y.discrepancy_reason||'',money(y.replacement_fee)])):`<div class="cx-empty">No discrepancy products on this RI.</div>`}
        ${total>known?`<div class="cx-seller-drill-note">This invoice contains ${num(total)} total products. Collectish currently persists the RI summary and discrepancy product rows, not every non-discrepant RI line item yet.</div>`:''}`);
    }catch(e){if(my===seq)open(`<div class="cx-empty">${esc(e.message)}</div>`)}
  }

  function cellText(row,index){return row?.querySelectorAll('td')?.[index]?.textContent?.trim()||''}
  document.addEventListener('click',e=>{
    const row=e.target.closest?.('#cxSellerParityBody tbody tr');if(!row)return;
    const active=document.querySelector('#cxSeller .cx-seller-tabs [data-seller-tab].active')?.dataset.sellerTab||'overview';
    const title=row.closest('.cx-card')?.querySelector('.cx-section-title')?.textContent?.trim()||'';
    let kind='',id='';
    if(active==='overview'||active==='orders'){kind='order';id=cellText(row,0)}
    else if(active==='refunds'||active==='reviews'){kind='order';id=cellText(row,1)}
    else if(active==='payments'){
      if(title==='Payments'){kind='payment';id=cellText(row,1)}
      else if(title==='Recent payment-linked orders'){kind='order';id=cellText(row,0)}
    }else if(active==='ris'){
      if(title==='Reimbursement invoices'||title==='Largest discrepancies'){kind='ri';id=cellText(row,0)}
    }
    if(!id)return;
    e.preventDefault();
    if(kind==='order')showOrder(id);else if(kind==='payment')showPayment(id);else if(kind==='ri')showRI(id);
  },true);

  const style=document.createElement('style');style.textContent=`
    #cxSellerParityBody tbody tr{cursor:pointer}
    .cx-seller-drill{display:none}.cx-seller-drill.open{display:block;position:fixed;inset:0;z-index:12000}.cx-seller-drill-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.35)}
    .cx-seller-drill-panel{position:absolute;right:0;top:0;bottom:0;width:min(720px,92vw);overflow:auto;background:var(--cx-card,#fff);padding:22px 18px 40px;box-shadow:-8px 0 30px rgba(15,23,42,.18)}
    .cx-seller-drill-close{position:sticky;top:0;float:right;z-index:2;width:38px;height:38px;border-radius:999px;border:1px solid var(--cx-line);background:var(--cx-card);font-size:24px}.cx-seller-drill-head h3{margin:0 50px 4px 0}.cx-seller-drill-head p{margin:0 0 14px;color:var(--cx-muted)}
    .cx-seller-drill-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 20px}.cx-seller-drill-stat{border:1px solid var(--cx-line);border-radius:12px;padding:10px}.cx-seller-drill-stat span,.cx-seller-drill-stat strong{display:block}.cx-seller-drill-stat span{font-size:10px;font-weight:800;color:var(--cx-muted);text-transform:uppercase}.cx-seller-drill-stat strong{margin-top:3px}.cx-seller-drill-panel h4{margin:18px 0 8px}.cx-seller-drill-note{margin-top:12px;padding:12px;border-radius:10px;background:var(--cx-bg);color:var(--cx-muted);font-size:12px}
    @media(max-width:980px){.cx-seller-drill-panel{left:0;right:0;top:8vh;bottom:0;width:auto;border-radius:18px 18px 0 0;padding-bottom:90px}.cx-seller-drill-stats{grid-template-columns:1fr 1fr}}
  `;document.head.appendChild(style);
})();
