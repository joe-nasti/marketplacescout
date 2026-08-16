// Collectish SYP parity — server-paged for fast mobile browsing
(() => {
  const PAGE=100;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const num=n=>Number(n||0).toLocaleString();
  const date=v=>v?new Date(v).toLocaleDateString():'—';
  let tab='products',page=0,sort={key:'last_seen',dir:'desc'},stats=null,opts={sets:[],conditions:[],event_types:[]},installed=false,loading=false,seq=0,debounce=0;

  const qp=(k,v)=>`${k}=${encodeURIComponent(v)}`;
  const sortOrder=()=>`${sort.key}.${sort.dir}`;
  const searchOr=(q,fields)=>q?`&or=(${fields.map(f=>`${f}.ilike.*${String(q).replace(/[,*()]/g,' ')}*`).join(',')})`:'';

  function shell(host){
    host.innerHTML=`<div class="cx-page-head"><div><h2>SYP</h2><p>Eligibility, quantities and product-state changes.</p></div><button id="cxSypParityRefresh" class="cx-refresh">Refresh</button></div>
      <div class="cx-kpis"><div class="cx-kpi"><span>Products</span><strong>${stats?num(stats.products):'—'}</strong></div><div class="cx-kpi"><span>Eligible</span><strong>${stats?num(stats.eligible):'—'}</strong></div><div class="cx-kpi"><span>Change events</span><strong>${stats?num(stats.events):'—'}</strong></div><div class="cx-kpi"><span>Added</span><strong>${stats?num(stats.added):'—'}</strong></div><div class="cx-kpi"><span>Removed</span><strong>${stats?num(stats.removed):'—'}</strong></div></div>
      <div class="cx-seller-tabs cx-syp-tabs"><button data-syp-tab="products" class="${tab==='products'?'active':''}">Eligible products</button><button data-syp-tab="events" class="${tab==='events'?'active':''}">Changes</button></div><div id="cxSypParityBody"></div>`;
    document.getElementById('cxSypParityRefresh').onclick=()=>load(true);
    host.querySelectorAll('[data-syp-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.sypTab;page=0;sort=tab==='products'?{key:'last_seen',dir:'desc'}:{key:'changed_at',dir:'desc'};renderBody()});
  }

  function productFilters(){return `<div class="cx-syp-filtergrid"><input id="cxSypSearch" placeholder="Search card, set or TCGplayer ID…"><select id="cxSypSet"><option value="">All sets</option>${(opts.sets||[]).map(x=>`<option>${esc(x)}</option>`).join('')}</select><select id="cxSypCondition"><option value="">All conditions</option>${(opts.conditions||[]).map(x=>`<option>${esc(x)}</option>`).join('')}</select><select id="cxSypMax"><option value="">Any max qty</option><option value="0">0</option><option value="1-4">1–4</option><option value="5-9">5–9</option><option value="10-24">10–24</option><option value="25-49">25–49</option><option value="50-99">50–99</option><option value="100+">100+</option></select><label>First seen since<input id="cxSypFirst" type="date"></label><label>Last seen since<input id="cxSypLast" type="date"></label><button id="cxSypExport" class="cx-refresh">Export filtered CSV</button></div><div id="cxSypCount" class="cx-syp-count"></div><div id="cxSypTable"></div><div id="cxSypPager" class="cx-syp-pager"></div>`}
  function eventFilters(){return `<div class="cx-syp-filtergrid cx-syp-eventfilters"><input id="cxSypEventSearch" placeholder="Search card, set or TCGplayer ID…"><select id="cxSypEventType"><option value="">All change types</option>${(opts.event_types||[]).map(x=>`<option>${esc(x)}</option>`).join('')}</select><button id="cxSypExport" class="cx-refresh">Export filtered CSV</button></div><div id="cxSypCount" class="cx-syp-count"></div><div id="cxSypTable"></div><div id="cxSypPager" class="cx-syp-pager"></div>`}

  function productPath(limit=PAGE,offset=page*PAGE){
    const q=document.getElementById('cxSypSearch')?.value.trim()||'',set=document.getElementById('cxSypSet')?.value||'',cond=document.getElementById('cxSypCondition')?.value||'',mq=document.getElementById('cxSypMax')?.value||'',first=document.getElementById('cxSypFirst')?.value,last=document.getElementById('cxSypLast')?.value;
    let s=`syp_products?select=tcgplayer_id,product_name,set_name,condition,market_price,current_max_quantity,first_seen,last_seen,is_currently_eligible&is_currently_eligible=eq.true&order=${sortOrder()}&limit=${limit}&offset=${offset}`;
    s+=searchOr(q,['product_name','set_name','tcgplayer_id']);
    if(set)s+=`&${qp('set_name','eq.'+set)}`; if(cond)s+=`&${qp('condition','eq.'+cond)}`;
    if(mq==='0')s+='&current_max_quantity=eq.0'; else if(mq==='100+')s+='&current_max_quantity=gte.100'; else if(mq){const [a,b]=mq.split('-');s+=`&current_max_quantity=gte.${a}&current_max_quantity=lte.${b}`}
    if(first)s+=`&first_seen=gte.${encodeURIComponent(first+'T00:00:00Z')}`; if(last)s+=`&last_seen=gte.${encodeURIComponent(last+'T00:00:00Z')}`;
    return s;
  }
  function eventPath(limit=PAGE,offset=page*PAGE){
    const q=document.getElementById('cxSypEventSearch')?.value.trim()||'',type=document.getElementById('cxSypEventType')?.value||'';
    let s=`syp_events?select=event_id,tcgplayer_id,product_name,set_name,event_type,old_value,new_value,difference,changed_at&order=${sortOrder()}&limit=${limit}&offset=${offset}`;
    s+=searchOr(q,['product_name','set_name','tcgplayer_id']); if(type)s+=`&${qp('event_type','eq.'+type)}`;return s;
  }

  function header(label,key){return `<th data-syp-sort="${key}" class="${sort.key===key?'sorted '+sort.dir:''}">${esc(label)}${sort.key===key?(sort.dir==='asc'?' ↑':' ↓'):''}</th>`}
  function pager(rows){const h=document.getElementById('cxSypPager');if(!h)return;h.innerHTML=`<button class="cx-refresh" id="cxSypPrev" ${page===0?'disabled':''}>Previous</button><span>Page ${page+1}</span><button class="cx-refresh" id="cxSypNext" ${rows.length<PAGE?'disabled':''}>Next</button>`;h.querySelector('#cxSypPrev').onclick=()=>{if(page){page--;loadPage()}};h.querySelector('#cxSypNext').onclick=()=>{if(rows.length===PAGE){page++;loadPage()}}}
  function wireSort(){document.querySelectorAll('#cxSypTable [data-syp-sort]').forEach(th=>th.onclick=()=>{const k=th.dataset.sypSort;if(sort.key===k)sort.dir=sort.dir==='asc'?'desc':'asc';else{sort.key=k;sort.dir=['product_name','set_name','condition','event_type'].includes(k)?'asc':'desc'}page=0;loadPage()})}

  async function loadPage(){
    const my=++seq,table=document.getElementById('cxSypTable'),count=document.getElementById('cxSypCount');if(!table)return;table.innerHTML='<div class="cx-empty">Loading…</div>';
    try{
      const rows=await rest(tab==='products'?productPath():eventPath());if(my!==seq)return;
      if(count)count.textContent=`${num(rows.length)} rows on this page • ${PAGE} per page`;
      if(tab==='products')table.innerHTML=`<div class="cx-table-wrap"><table class="cx-table cx-syp-table"><thead><tr>${header('Product','product_name')}${header('Set','set_name')}${header('Condition','condition')}${header('Market','market_price')}${header('Max qty','current_max_quantity')}${header('First seen','first_seen')}${header('Last seen','last_seen')}</tr></thead><tbody>${rows.map(p=>`<tr><td data-label="Product" class="cx-cardname">${esc(p.product_name)}<span class="cx-sub">TCG ${esc(p.tcgplayer_id)}</span></td><td data-label="Set">${esc(p.set_name)}</td><td data-label="Condition">${esc(p.condition)}</td><td data-label="Market">${money(p.market_price)}</td><td data-label="Max qty">${num(p.current_max_quantity)}</td><td data-label="First seen">${date(p.first_seen)}</td><td data-label="Last seen">${date(p.last_seen)}</td></tr>`).join('')}</tbody></table></div>`;
      else table.innerHTML=`<div class="cx-table-wrap"><table class="cx-table cx-syp-table"><thead><tr>${header('Changed','changed_at')}${header('Type','event_type')}${header('Product','product_name')}${header('Set','set_name')}${header('Old','old_value')}${header('New','new_value')}${header('Δ','difference')}</tr></thead><tbody>${rows.map(e=>`<tr><td data-label="Changed">${date(e.changed_at)}</td><td data-label="Type"><span class="cx-syp-event cx-syp-${String(e.event_type||'').toLowerCase()}">${esc(e.event_type)}</span></td><td data-label="Product" class="cx-cardname">${esc(e.product_name)}<span class="cx-sub">TCG ${esc(e.tcgplayer_id)}</span></td><td data-label="Set">${esc(e.set_name)}</td><td data-label="Old">${e.old_value==null?'—':num(e.old_value)}</td><td data-label="New">${e.new_value==null?'—':num(e.new_value)}</td><td data-label="Δ">${e.difference==null?'—':num(e.difference)}</td></tr>`).join('')}</tbody></table></div>`;
      wireSort();pager(rows);
    }catch(e){if(my===seq)table.innerHTML=`<div class="cx-empty">${esc(e.message)}</div>`}
  }

  function schedulePage(){clearTimeout(debounce);debounce=setTimeout(()=>{page=0;loadPage()},250)}
  async function exportAll(){
    const btn=document.getElementById('cxSypExport');if(btn){btn.disabled=true;btn.textContent='Preparing…'}
    try{const out=[];for(let off=0;;off+=1000){const path=tab==='products'?productPath(1000,off):eventPath(1000,off);const r=await rest(path);out.push(...r);if(r.length<1000)break}const fields=tab==='products'?[['TCGplayer ID','tcgplayer_id'],['Product','product_name'],['Set','set_name'],['Condition','condition'],['Market Price','market_price'],['Max Quantity','current_max_quantity'],['First Seen','first_seen'],['Last Seen','last_seen']]:[['Changed At','changed_at'],['Event Type','event_type'],['TCGplayer ID','tcgplayer_id'],['Product','product_name'],['Set','set_name'],['Old Value','old_value'],['New Value','new_value'],['Difference','difference']];const quote=v=>`"${String(v??'').replace(/"/g,'""')}"`,text=[fields.map(x=>quote(x[0])).join(','),...out.map(r=>fields.map(x=>quote(r[x[1]])).join(','))].join('\n'),blob=new Blob([text],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=tab==='products'?'TCGplayer_SYP_current_eligible_filtered.csv':'TCGplayer_SYP_latest_changes_filtered.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}finally{if(btn){btn.disabled=false;btn.textContent='Export filtered CSV'}}
  }

  function renderBody(){const body=document.getElementById('cxSypParityBody');if(!body)return;body.innerHTML=tab==='products'?productFilters():eventFilters();if(tab==='products'){['cxSypSet','cxSypCondition','cxSypMax','cxSypFirst','cxSypLast'].forEach(id=>document.getElementById(id).onchange=schedulePage);document.getElementById('cxSypSearch').oninput=schedulePage}else{document.getElementById('cxSypEventSearch').oninput=schedulePage;document.getElementById('cxSypEventType').onchange=schedulePage}document.getElementById('cxSypExport').onclick=exportAll;loadPage()}

  async function load(force=false){
    const host=document.getElementById('cxSyp');if(!host||loading)return;loading=true;host.dataset.sypParity='loading';host.innerHTML='<div class="cx-page-head"><div><h2>SYP</h2><p>Eligibility, quantities and product-state changes.</p></div></div><div class="cx-empty">Loading SYP…</div>';
    try{[stats,opts]=await Promise.all([rest('rpc/syp_dashboard_stats',{method:'POST',body:{}}),rest('rpc/syp_filter_options_rpc',{method:'POST',body:{}})]);shell(host);renderBody();host.dataset.sypParity='ready'}catch(e){host.innerHTML=`<div class="cx-empty">${esc(e.message)}</div>`}finally{loading=false}
  }
  function install(){const h=document.getElementById('cxSyp');if(!h)return false;if(!installed){installed=true;document.addEventListener('click',e=>{if(e.target.closest('[data-cx-page="syp"]'))setTimeout(()=>{if(document.getElementById('cxSyp')?.dataset.sypParity!=='ready')load()},60)},true)}if(h.classList.contains('active')&&h.dataset.sypParity!=='ready')load();return true}
  const mo=new MutationObserver(()=>install());mo.observe(document.documentElement,{childList:true,subtree:true});if(!install())setTimeout(install,100);

  const style=document.createElement('style');style.textContent=`.cx-syp-pager{display:flex;justify-content:center;align-items:center;gap:10px;margin:12px 0 4px}.cx-syp-pager button:disabled{opacity:.4}`;document.head.appendChild(style);
})();