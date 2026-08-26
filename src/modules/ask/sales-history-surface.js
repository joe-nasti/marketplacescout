// First-class Ask surface for TCG sales history. Render volume, not market price.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ask=text=>window.AskCollectish?.send?.(text);
  const fmt=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:1});
  function chart(obs){
    const rows=(obs||[]).filter(x=>Number.isFinite(Number(x.quantity)));if(!rows.length)return null;
    const vals=rows.map(x=>Number(x.quantity||0)),max=Math.max(1,...vals),w=320,h=98,p=8,innerW=w-p*2,innerH=h-p*2,gap=Math.max(1,innerW/rows.length*.18),bw=Math.max(2,innerW/rows.length-gap);
    const bars=rows.map((x,i)=>{const v=Number(x.quantity||0),bh=(v/max)*innerH,xx=p+i*(innerW/rows.length)+gap/2,yy=h-p-bh;return `<rect x="${xx.toFixed(2)}" y="${yy.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(1,bh).toFixed(2)}" rx="1"><title>${esc(x.date||'')} · ${fmt(v)} units · ${fmt(x.transaction_count)} tx</title></rect>`}).join('');
    const box=document.createElement('div');box.className='cx-ask-sales-chart';box.innerHTML=`<svg viewBox="0 0 ${w} ${h}" width="100%" height="98" role="img" aria-label="TCG sales volume by bucket"><g fill="currentColor" opacity=".78">${bars}</g></svg>`;return box;
  }
  function action(a){const b=document.createElement('button');b.type='button';b.className='cx-ask-surface-action is-secondary';b.textContent=a.label||'Open';b.onclick=()=>a.type==='ask'&&a.prompt&&ask(a.prompt);return b}
  function render(surface){
    const el=document.createElement('section');el.className='cx-ask-surface cx-ask-sales-history-surface';const s=surface.summary||{},range=surface.range?.label||'',units=Number(surface.total_units||0),tx=Number(surface.total_transactions||0),daily=Number(s.average_daily_quantity_sold||0),txDaily=Number(s.average_daily_transaction_count||0);
    el.innerHTML=`<div class="cx-ask-surface-heading"><strong>${esc(surface.title||'TCG sales history')}</strong><span>${esc([range,`${surface.count||0} buckets`].filter(Boolean).join(' · '))}</span></div><div class="cx-ask-surface-metrics"><span><small>Units sold</small><b>${fmt(units)}</b></span><span><small>Transactions</small><b>${fmt(tx)}</b></span><span><small>Cards / day</small><b>${daily.toFixed(1)}</b></span></div><div class="cx-ask-sales-caption">Exact SKU ${esc(surface.sku_id||'')} · ${txDaily.toFixed(1)} transactions/day · marketplace sales</div>`;
    const c=chart(surface.observations);if(c)el.append(c);const bar=document.createElement('div');bar.className='cx-ask-surface-actions';(surface.actions||[]).slice(0,2).forEach(a=>bar.append(action(a)));if(bar.children.length)el.append(bar);return el;
  }
  function onMessage(ev){const {role,element}=ev.detail||{};if(role!=='assistant'||!element)return;const queued=window.__CollectishAskSurfaceQueue?.[0];if(!queued?.surfaces?.length)return;const sales=queued.surfaces.filter(s=>s?.type==='sales_history');if(!sales.length)return;queued.surfaces=queued.surfaces.filter(s=>s?.type!=='sales_history');const msg=element.closest('.cx-ask-msg');if(!msg)return;const host=document.createElement('div');host.className='cx-ask-sales-history-surfaces';sales.forEach(s=>host.append(render(s)));msg.append(host);requestAnimationFrame(()=>host.scrollIntoView({block:'nearest'}));
  }
  const style=document.createElement('style');style.textContent=`.cx-ask-sales-caption{font-size:11px;color:var(--cx-muted);padding:7px 14px 0}.cx-ask-sales-chart{padding:3px 12px 10px;color:var(--cx-accent,#1473e6)}.cx-ask-sales-history-surfaces{display:grid;gap:8px;margin-top:8px}`;document.head.appendChild(style);
  document.addEventListener('collectish:ask-message-rendered',onMessage);
})();
