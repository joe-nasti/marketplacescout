import {rest} from '../../core/rest.js';

const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const money=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const when=value=>{const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const now=Date.now(),ms=Math.max(0,now-d.getTime()),h=ms/36e5;if(h<24)return h<1?`${Math.max(1,Math.round(h*60))}m ago`:`${Math.round(h)}h ago`;if(h<24*7)return `${Math.round(h/24)}d ago`;return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})};
let request=0;
let activeDays=30;
let currentRow=null;

function sourceLabel(source){
  if(source==='cardkingdom')return 'CK';
  if(source==='tcgplayer'||source==='tcgplayer_marketplace')return 'TCG';
  if(source==='syp')return 'SYP';
  if(source==='collectish_scout')return 'Scout';
  return String(source||'Market').replace(/_/g,' ');
}

function icon(kind){
  if(kind==='price')return '↕';
  if(kind==='sales')return '⇄';
  if(kind==='vendor_depth')return '▥';
  if(kind==='syp')return '⇧';
  if(kind==='scout')return '◎';
  if(kind==='signal')return '✦';
  return '•';
}

function eventRow(event){
  const data=event?.data||{};
  let quick='';
  if(event.kind==='sales'&&data.quantity_sold!=null)quick=`${Number(data.quantity_sold).toLocaleString()} sold`;
  else if(event.kind==='vendor_depth'){
    const parts=[];
    if(data.retail_qty!=null)parts.push(`${Number(data.retail_qty).toLocaleString()} retail`);
    if(data.buylist_qty!=null)parts.push(`wants ${Number(data.buylist_qty).toLocaleString()}`);
    if(data.buylist_price!=null)parts.push(`@ ${money(data.buylist_price)}`);
    quick=parts.join(' · ');
  } else if(event.kind==='syp'){
    const from=data.old_max_quantity,to=data.new_max_quantity,diff=data.difference;
    if(from!=null&&to!=null)quick=`Max ${Number(from).toLocaleString()} → ${Number(to).toLocaleString()}${diff!=null?` (${Number(diff)>0?'+':''}${Number(diff).toLocaleString()})`:''}`;
    else if(to!=null)quick=`Accepting up to ${Number(to).toLocaleString()}`;
    else if(from!=null)quick=`Was accepting up to ${Number(from).toLocaleString()}`;
  } else if(event.kind==='scout'){
    const parts=[];
    if(data.grade!=null)parts.push(`Grade ${data.grade}`);
    if(data.score!=null)parts.push(`Score ${data.score}`);
    if(data.flag)parts.push(String(data.flag).replace(/_/g,' '));
    quick=parts.join(' · ');
  } else if(event.kind==='price'){
    if(data.market_to!=null)quick=`Market ${money(data.market_to)}`;
    else if(data.direct_to!=null)quick=`Direct ${money(data.direct_to)}`;
  }
  return `<div class="cx-market-timeline-event cx-market-timeline-${esc(event.kind||'other')}">
    <div class="cx-market-timeline-dot">${esc(icon(event.kind))}</div>
    <div class="cx-market-timeline-copy">
      <div class="cx-market-timeline-top"><strong>${esc(event.title||'Market event')}</strong><span>${esc(sourceLabel(event.source))} · ${esc(when(event.event_at))}</span></div>
      ${quick?`<b class="cx-market-timeline-quick">${esc(quick)}</b>`:''}
      ${event.detail?`<small>${esc(event.detail)}</small>`:''}
    </div>
  </div>`;
}

function render(data,days){
  const events=Array.isArray(data?.events)?data.events:[];
  const visible=events.slice(-14).reverse();
  const coverage=data?.coverage||{};
  const covered=[coverage.tcg_price_history&&'price',coverage.tcg_sales_history&&'sales',coverage.cardkingdom_depth&&'CK',coverage.syp&&'SYP',coverage.scout_score_history&&'Scout',coverage.signals&&'signals'].filter(Boolean);
  const controls=[7,30,90].map(d=>`<button type="button" data-market-timeline-days="${d}" class="${d===days?'active':''}">${d}d</button>`).join('');
  const body=visible.length?visible.map(eventRow).join(''):`<div class="cx-market-timeline-empty">No material market changes recorded in this window.</div>`;
  return `<section class="cx-v5-section cx-market-timeline" data-days="${days}">
    <div class="cx-market-timeline-head">
      <div><div class="cx-section-title">Market history</div><p class="cx-sub">What changed around this exact printing, from preserved Collectish evidence.</p></div>
      <div class="cx-market-timeline-controls">${controls}</div>
    </div>
    <div class="cx-market-timeline-meta"><span>${Number(data?.event_count||0).toLocaleString()} events</span>${covered.length?`<span>${esc(covered.join(' · '))}</span>`:''}</div>
    <div class="cx-market-timeline-list">${body}</div>
    ${events.length>14?`<small class="cx-market-timeline-more">Showing the 14 most recent material events.</small>`:''}
    ${coverage.syp?'<small class="cx-market-timeline-note">SYP quantities are seller-program acceptance limits (demand evidence), not marketplace sales or inventory.</small>':''}
  </section>`;
}

async function load(row,days=activeDays){
  const host=document.getElementById('cxParityDetail');
  if(!host||!row?.product_id||!row?.sku_id)return;
  const seq=++request;
  host.querySelector('.cx-market-timeline')?.remove();
  const placeholder=document.createElement('section');
  placeholder.className='cx-v5-section cx-market-timeline cx-market-timeline-loading';
  placeholder.innerHTML='<div class="cx-section-title">Market history</div><p class="cx-sub">Loading preserved market evidence…</p>';
  const anchor=host.querySelector('.cx-vendor-depth')||host.querySelector('.cx-scout-market-board')||host.querySelector('.cx-scout-why-buy');
  if(anchor)anchor.insertAdjacentElement('afterend',placeholder);else host.appendChild(placeholder);
  try{
    const data=await rest('rpc/ask_collectish_market_timeline_v2',{method:'POST',body:{p_product_id:String(row.product_id),p_sku_id:String(row.sku_id),p_days:days}});
    if(seq!==request||!document.getElementById('cxParityDetail'))return;
    const section=document.createRange().createContextualFragment(render(data,days)).firstElementChild;
    placeholder.replaceWith(section);
  }catch(error){
    if(seq!==request)return;
    placeholder.innerHTML='<div class="cx-section-title">Market history</div><p class="cx-sub">Historical evidence is temporarily unavailable.</p>';
    console.warn('Market timeline unavailable',error);
  }
}

function decorate(event){
  currentRow=event.detail?.row||null;
  activeDays=30;
  void load(currentRow,activeDays);
}

document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-market-timeline-days]');
  if(!button||!currentRow)return;
  const days=Number(button.dataset.marketTimelineDays||30);
  if(![7,30,90].includes(days)||days===activeDays)return;
  activeDays=days;
  void load(currentRow,activeDays);
});

document.addEventListener('collectish:scout-detail-rendered',decorate);

const style=document.createElement('style');
style.textContent=`
.cx-market-timeline-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.cx-market-timeline-head .cx-sub{margin:2px 0 0}.cx-market-timeline-controls{display:flex;gap:4px;flex:0 0 auto}.cx-market-timeline-controls button{border:1px solid var(--cx-line);background:var(--cx-bg);color:var(--cx-muted);border-radius:8px;padding:5px 7px;font-size:11px;font-weight:700}.cx-market-timeline-controls button.active{color:var(--cx-text);border-color:var(--cx-accent);background:color-mix(in srgb,var(--cx-accent) 10%,var(--cx-bg))}.cx-market-timeline-meta{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.cx-market-timeline-meta span{font-size:10px;color:var(--cx-muted);border:1px solid var(--cx-line);border-radius:999px;padding:3px 7px}.cx-market-timeline-list{position:relative;display:grid;gap:0}.cx-market-timeline-event{display:grid;grid-template-columns:24px 1fr;gap:7px;padding:7px 0;border-top:1px solid var(--cx-line)}.cx-market-timeline-event:first-child{border-top:0}.cx-market-timeline-dot{width:22px;height:22px;border-radius:999px;display:grid;place-items:center;background:var(--cx-bg);border:1px solid var(--cx-line);font-size:11px;font-weight:800}.cx-market-timeline-syp .cx-market-timeline-dot,.cx-market-timeline-scout .cx-market-timeline-dot{border-color:var(--cx-accent);background:color-mix(in srgb,var(--cx-accent) 8%,var(--cx-bg))}.cx-market-timeline-scout .cx-market-timeline-dot{font-size:13px}.cx-market-timeline-copy{min-width:0}.cx-market-timeline-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.cx-market-timeline-top strong{font-size:12px}.cx-market-timeline-top span{white-space:nowrap;color:var(--cx-muted);font-size:10px}.cx-market-timeline-copy small{display:block;color:var(--cx-muted);font-size:10px;line-height:1.35;margin-top:2px}.cx-market-timeline-quick{display:block;font-size:11px;margin-top:1px}.cx-market-timeline-more,.cx-market-timeline-empty,.cx-market-timeline-note{display:block;color:var(--cx-muted);font-size:10px;margin-top:6px}.cx-market-timeline-note{padding-top:6px;border-top:1px solid var(--cx-line)}.cx-market-timeline-loading{min-height:66px}@media(max-width:520px){.cx-market-timeline-head{display:block}.cx-market-timeline-controls{margin-top:8px}.cx-market-timeline-top{align-items:flex-start}.cx-market-timeline-top strong{max-width:68%}}
`;
document.head.appendChild(style);
