// Collectish web v0.5.0 — unified cloud app shell
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion");if(badge)badge.textContent="web v0.5.0";
  if(!document.querySelector('link[data-collectish-v050]')){const l=document.createElement("link");l.rel="stylesheet";l.href="v050.css?v=050";l.dataset.collectishV050="1";document.head.appendChild(l)}

  const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const date=v=>v?new Date(v).toLocaleDateString():"—";
  const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const sum=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
  const agoDays=n=>new Date(Date.now()-n*86400000).toISOString();
  const state={loaded:new Set(),sales:null,direct:null,money:null};

  function classifyOriginalSections(){
    const app=el("app");if(!app)return;
    for(const section of [...app.children].filter(x=>x.tagName==="SECTION")){
      const title=(section.querySelector("h2")?.textContent||"").trim();
      let page="scout";
      if(["PC status","New scan","Scan profiles","Requests"].includes(title))page="operations";
      else if(title==="Find any scanned card")page="cards";
      else page="scout";
      section.dataset.collectishPage=page;
    }
  }

  function makeHost(id,title,subtitle){
    const host=document.createElement("div");host.id=id;host.className="collectish-page-host";
    host.innerHTML=`<div class="collectish-page-title"><div><h2>${title}</h2><p class="meta">${subtitle}</p></div><button class="collectish-refresh" type="button">Refresh</button></div><div class="collectish-page-body"><div class="collectish-section"><div class="collectish-empty">Open this section to load cloud data.</div></div></div>`;
    el("app").appendChild(host);
    return host;
  }

  function installShell(){
    const app=el("app");if(!app||el("collectishProductNav"))return false;
    classifyOriginalSections();
    const nav=document.createElement("nav");nav.id="collectishProductNav";nav.className="collectish-product-nav";
    const pages=[["scout","Scout"],["cards","Cards"],["sales","Sales"],["direct","Direct"],["money","Money"],["operations","Operations"]];
    nav.innerHTML=pages.map(([id,label])=>`<button type="button" data-page="${id}">${label}</button>`).join("");
    app.insertBefore(nav,app.firstChild);
    makeHost("collectishSalesPage","Sales","Orders, realized selling activity, and product performance from the shared Collectish ledger.");
    makeHost("collectishDirectPage","Direct","SYP eligibility, reimbursement invoices, and discrepancy history.");
    makeHost("collectishMoneyPage","Money","Payments, fees, refunds, adjustments, and reconciliation signals.");
    nav.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
    for(const host of [el("collectishSalesPage"),el("collectishDirectPage"),el("collectishMoneyPage")])host.querySelector(".collectish-refresh").addEventListener("click",()=>loadPage(host.id.replace("collectish","").replace("Page","").toLowerCase(),true));
    showPage(localStorage.getItem("collectishPage")||"scout");
    return true;
  }

  function showPage(page){
    localStorage.setItem("collectishPage",page);
    document.querySelectorAll("#collectishProductNav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    document.querySelectorAll("#app > section[data-collectish-page]").forEach(s=>s.classList.toggle("collectish-page-hidden",s.dataset.collectishPage!==page));
    const hosts={sales:el("collectishSalesPage"),direct:el("collectishDirectPage"),money:el("collectishMoneyPage")};
    Object.entries(hosts).forEach(([k,h])=>h?.classList.toggle("active",k===page));
    if(hosts[page])loadPage(page,false);
    window.scrollTo({top:0,behavior:"smooth"});
  }

  async function query(path){return await rest(path)}

  async function loadPage(page,force){
    if(state.loaded.has(page)&&!force)return;
    const host={sales:el("collectishSalesPage"),direct:el("collectishDirectPage"),money:el("collectishMoneyPage")}[page];if(!host)return;
    const body=host.querySelector(".collectish-page-body");body.innerHTML='<div class="collectish-section"><div class="collectish-empty">Loading Collectish Cloud…</div></div>';
    try{
      if(page==="sales")await loadSales(body);
      if(page==="direct")await loadDirect(body);
      if(page==="money")await loadMoney(body);
      state.loaded.add(page);
    }catch(e){body.innerHTML=`<div class="collectish-section"><div class="collectish-empty">${esc(e.message)}</div></div>`}
  }

  async function loadSales(body){
    const since=encodeURIComponent(agoDays(90));
    const [orders,items]=await Promise.all([
      query(`seller_orders?select=order_number,order_date,order_fulfillment,order_status,gross_amount,fee_amount,direct_fee_amount,net_amount,refund_total&order_date=gte.${since}&order=order_date.desc&limit=1000`),
      query(`seller_order_items?select=order_number,order_date,product_name,product_id,sku_id,quantity,extended_price,order_fulfillment&order_date=gte.${since}&order=order_date.desc&limit=1000`)
    ]);
    const gross=sum(orders,"gross_amount"),refunds=sum(orders,"refund_total"),fees=orders.reduce((n,r)=>n+Number(r.fee_amount||0)+Number(r.direct_fee_amount||0),0),net=orders.reduce((n,r)=>n+Number(r.net_amount||0)-Number(r.refund_total||0),0);
    const bySku=new Map();for(const r of items){const k=r.sku_id||r.product_id||r.product_name;const x=bySku.get(k)||{name:r.product_name,sku:r.sku_id,qty:0,sales:0};x.qty+=Number(r.quantity||0);x.sales+=Number(r.extended_price||0);bySku.set(k,x)}
    const top=[...bySku.values()].sort((a,b)=>b.sales-a.sales).slice(0,15);
    body.innerHTML=`<div class="collectish-kpi-grid">${[["Orders (90d)",orders.length.toLocaleString()],["Gross",money(gross)],["Fees",money(fees)],["Net after refunds",money(net)]].map(([a,b])=>`<div class="collectish-kpi"><span>${a}</span><strong>${b}</strong></div>`).join("")}</div>
      <div class="collectish-section"><h3>Recent orders</h3><div class="meta">Latest cloud-backed orders from the last 90 days. Showing up to 100.</div><div class="collectish-mobile-table"><table><thead><tr><th>Date</th><th>Order</th><th>Type</th><th>Gross</th><th>Fees</th><th>Refund</th><th>Net</th></tr></thead><tbody>${orders.slice(0,100).map(r=>`<tr><td>${date(r.order_date)}</td><td>${esc(r.order_number)}</td><td>${esc(r.order_fulfillment||"")}</td><td>${money(r.gross_amount)}</td><td>${money(Number(r.fee_amount||0)+Number(r.direct_fee_amount||0))}</td><td>${money(r.refund_total)}</td><td>${money(Number(r.net_amount||0)-Number(r.refund_total||0))}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="collectish-section"><h3>Top products in loaded 90-day activity</h3><div class="meta">Based on the most recent cloud order-item rows currently loaded.</div><div class="collectish-mobile-table"><table><thead><tr><th>Product</th><th>SKU</th><th>Units</th><th>Sales</th></tr></thead><tbody>${top.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.sku||"")}</td><td>${x.qty.toLocaleString()}</td><td>${money(x.sales)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  async function loadDirect(body){
    const [products,events,ris,disc]=await Promise.all([
      query("syp_products?select=tcgplayer_id,product_name,set_name,condition,market_price,current_max_quantity,first_seen,last_seen,is_currently_eligible&is_currently_eligible=eq.true&order=last_seen.desc&limit=1000"),
      query("syp_events?select=changed_at,event_type,tcgplayer_id,product_name,set_name,old_value,new_value,difference&order=changed_at.desc&limit=100"),
      query("reimbursement_invoices?select=ri_number,created_date,status,total_product_count,total_product_value,total_replacement_fees,discrepancy_quantity,discrepancy_row_count&order=created_date.desc&limit=100"),
      query("ri_discrepancies?select=ri_number,product_name,set_name,expected_condition,quantity,discrepancy,discrepancy_reason,replacement_fee&limit=1000")
    ]);
    const open=ris.filter(r=>String(r.status||"").toUpperCase()!=="COMPLETED"),discQty=sum(disc,"discrepancy"),replacement=sum(ris,"total_replacement_fees");
    body.innerHTML=`<div class="collectish-kpi-grid">${[["SYP eligible",products.length.toLocaleString()],["Recent SYP changes",events.length.toLocaleString()],["Open RIs",open.length.toLocaleString()],["RI replacement fees",money(replacement)]].map(([a,b])=>`<div class="collectish-kpi"><span>${a}</span><strong>${b}</strong></div>`).join("")}</div>
      <div class="collectish-section"><h3>Latest SYP changes</h3><div class="collectish-mobile-table"><table><thead><tr><th>Changed</th><th>Type</th><th>Product</th><th>Set</th><th>Old</th><th>New</th></tr></thead><tbody>${events.slice(0,50).map(r=>`<tr><td>${date(r.changed_at)}</td><td><span class="collectish-status-pill">${esc(r.event_type)}</span></td><td>${esc(r.product_name)}</td><td>${esc(r.set_name)}</td><td>${r.old_value??"—"}</td><td>${r.new_value??"—"}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="collectish-section"><h3>Reimbursement invoices</h3><div class="meta">Newest RI records from Seller History cloud backup.</div><div class="collectish-mobile-table"><table><thead><tr><th>RI</th><th>Date</th><th>Status</th><th>Products</th><th>Value</th><th>Discrepancies</th><th>Replacement fees</th></tr></thead><tbody>${ris.map(r=>`<tr><td>${esc(r.ri_number)}</td><td>${date(r.created_date)}</td><td>${esc(r.status)}</td><td>${Number(r.total_product_count||0).toLocaleString()}</td><td>${money(r.total_product_value)}</td><td>${Number(r.discrepancy_quantity||0).toLocaleString()}</td><td>${money(r.total_replacement_fees)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  async function loadMoney(body){
    const [payments,adjustments]=await Promise.all([
      query("seller_payments?select=payment_id,arrival_date,initiated_on,order_count,total_sales,total_fees,refunded_orders,refunded_fees,adjustments,payment,is_pending&order=initiated_on.desc&limit=250"),
      query("seller_payment_adjustments?select=payment_id,amount,reason,order_number,ri_number&limit=1000")
    ]);
    const paid=sum(payments,"payment"),sales=sum(payments,"total_sales"),fees=sum(payments,"total_fees"),refunds=sum(payments,"refunded_orders"),adjustmentTotal=sum(adjustments,"amount");
    body.innerHTML=`<div class="collectish-kpi-grid">${[["Payment batches",payments.length.toLocaleString()],["Sales in batches",money(sales)],["Fees",money(fees)],["Payments",money(paid)]].map(([a,b])=>`<div class="collectish-kpi"><span>${a}</span><strong>${b}</strong></div>`).join("")}</div>
      <div class="collectish-section"><h3>Payment history</h3><div class="meta">Cloud-backed TCGplayer payment batches. Refunds ${money(refunds)} • parsed adjustment rows ${adjustments.length.toLocaleString()} (${money(adjustmentTotal)}).</div><div class="collectish-mobile-table"><table><thead><tr><th>Initiated</th><th>Orders</th><th>Sales</th><th>Fees</th><th>Refunded</th><th>Adjustments</th><th>Payment</th></tr></thead><tbody>${payments.slice(0,100).map(r=>`<tr><td>${date(r.initiated_on||r.arrival_date)}</td><td>${Number(r.order_count||0).toLocaleString()}</td><td>${money(r.total_sales)}</td><td>${money(r.total_fees)}</td><td>${money(r.refunded_orders)}</td><td>${money(r.adjustments)}</td><td><strong>${money(r.payment)}</strong></td></tr>`).join("")}</tbody></table></div></div>
      <div class="collectish-section"><h3>Recent adjustments</h3><div class="collectish-mobile-table"><table><thead><tr><th>Payment</th><th>Amount</th><th>Order</th><th>RI</th><th>Reason</th></tr></thead><tbody>${adjustments.slice(0,100).map(r=>`<tr><td>${esc(r.payment_id)}</td><td>${money(r.amount)}</td><td>${esc(r.order_number||"")}</td><td>${esc(r.ri_number||"")}</td><td>${esc(r.reason||"")}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  let tries=0;const timer=setInterval(()=>{tries++;if(installShell()||tries>120)clearInterval(timer)},100);
})();
