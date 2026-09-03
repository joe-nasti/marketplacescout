import { rest } from '../../core/rest.js';

let installed=false;
let renderSeq=0;

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const num=n=>n==null||n===''||!Number.isFinite(Number(n))?null:Number(n);
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;

function injectStyles(){
  if(document.getElementById('cxSealedOutOptimizerStyles'))return;
  const style=document.createElement('style');
  style.id='cxSealedOutOptimizerStyles';
  style.textContent=`
    .cx-out-opt{margin:16px 0;padding:14px;border:1px solid var(--cx-border,#2a3441);border-radius:14px;background:color-mix(in srgb,var(--cx-card,#151b22) 94%,transparent)}
    .cx-out-opt-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;margin-bottom:10px}
    .cx-out-opt-head h4{margin:0;font-size:15px}.cx-out-opt-head p{margin:3px 0 0;font-size:12px;opacity:.72;max-width:660px}
    .cx-out-opt-actions{display:flex;gap:7px;flex-wrap:wrap}.cx-out-opt button{font:inherit}
    .cx-out-opt-btn{border:1px solid var(--cx-border,#34404d);background:transparent;color:inherit;border-radius:9px;padding:6px 9px;cursor:pointer}
    .cx-out-opt-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}
    .cx-out-opt-stat{padding:9px 10px;border:1px solid var(--cx-border,#2b3540);border-radius:10px;min-width:0}
    .cx-out-opt-stat span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.05em;opacity:.66}.cx-out-opt-stat b{display:block;margin-top:2px;font-size:16px}.cx-out-opt-stat small{display:block;margin-top:2px;font-size:10px;opacity:.66;white-space:normal}
    .cx-out-opt-dream{border-color:color-mix(in srgb,#6c8cff 55%,var(--cx-border,#2b3540))}
    .cx-out-opt-potential{border-style:dashed}
    .cx-out-opt-mix{display:flex;flex-wrap:wrap;gap:7px;margin:9px 0}.cx-out-opt-chip{padding:5px 8px;border:1px solid var(--cx-border,#34404d);border-radius:999px;font-size:11px}
    .cx-out-opt-children{display:grid;gap:6px;margin:9px 0}.cx-out-opt-child{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;padding:8px 9px;border:1px solid var(--cx-border,#34404d);border-radius:9px;font-size:11px}.cx-out-opt-child span{opacity:.72;text-align:right}
    .cx-out-opt-warning{margin:8px 0;padding:8px 10px;border-radius:9px;background:rgba(235,171,50,.10);border:1px solid rgba(235,171,50,.28);font-size:11px;line-height:1.35}
    .cx-out-opt-note{margin:7px 0 0;font-size:10px;opacity:.68;line-height:1.35}
    .cx-out-opt-details{margin-top:10px}.cx-out-opt-details summary{cursor:pointer;font-size:12px;font-weight:650;padding:4px 0}
    .cx-out-opt-table-wrap{overflow:auto;max-height:440px;margin-top:8px;border:1px solid var(--cx-border,#2b3540);border-radius:10px}
    table.cx-out-opt-table{border-collapse:collapse;width:100%;min-width:980px;font-size:11px}table.cx-out-opt-table th,table.cx-out-opt-table td{padding:7px 8px;border-bottom:1px solid var(--cx-border,#2b3540);text-align:right;white-space:nowrap}table.cx-out-opt-table th:first-child,table.cx-out-opt-table td:first-child{text-align:left;position:sticky;left:0;background:var(--cx-card,#151b22);z-index:1}table.cx-out-opt-table thead th{position:sticky;top:0;background:var(--cx-card,#151b22);z-index:2}table.cx-out-opt-table thead th:first-child{z-index:3}
    .cx-out-opt-route{font-weight:650}.cx-out-opt-slow{opacity:.72}.cx-out-opt-unmeasured{opacity:.55}
    @media(max-width:760px){.cx-out-opt-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cx-out-opt-head{display:block}.cx-out-opt-actions{margin-top:8px}.cx-out-opt-child{grid-template-columns:1fr auto}.cx-out-opt-child span:first-of-type{display:none}}
  `;
  document.head.appendChild(style);
}

function csvEscape(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
function childOutContribution(children=[]){
  let childNet=0,additiveNet=0,fixedChildren=0,randomizedChildren=0,unresolvedChildren=0;const routes=new Map();
  for(const child of children){
    const basis=String(child.valuation_basis||'').toLowerCase(),value=Number(child.quantity||0)*Number(child.practical_liquidation_ev||0);
    childNet+=value;
    if(basis.includes('fixed'))fixedChildren+=1;
    else if(basis){randomizedChildren+=1;additiveNet+=value;const channel=child.selected_exit_route==='sell_sealed'?'Sell child sealed':child.selected_exit_route==='crack'?'Crack child':'Randomized practical out';routes.set(channel,(routes.get(channel)||0)+value)}
    else unresolvedChildren+=1;
  }
  // Fixed-card children are already expanded into the parent's routing rows.
  // Randomized children remain additive; unresolved children fail closed.
  return {childNet,additiveNet,additiveRoutes:[...routes].map(([channel,ev])=>({channel,ev})),alreadyRouted:fixedChildren>0&&randomizedChildren===0&&unresolvedChildren===0,fixedChildren,randomizedChildren,unresolvedChildren};
}
function exportCsv(row,rows,children=[]){
  const cols=[
    ['Card','card_name'],['SKU','sku_id'],['Finish','finish'],['Qty','quantity'],
    ['Live chosen outlet','live_best_channel'],['Live unit net','live_best_unit_net'],['Live component EV','live_best_component_ev'],
    ['Potential chosen outlet','potential_best_channel'],['Potential unit net','potential_best_unit_net'],['Potential component EV','potential_best_component_ev'],
    ['TCG Direct live net','tcg_direct_live_net'],['TCG Regular net','tcg_regular_net'],['ManaPool net est','manapool_net_est'],['CK cash','ck_cash'],['SYP potential net capped','syp_potential_net_capped'],['SYP max qty','syp_max_quantity'],
    ['Avg daily qty sold','avg_daily_qty_sold'],['Estimated days to sell','estimated_days_to_sell']
  ];
  const lines=[cols.map(x=>csvEscape(x[0])).join(','),...rows.map(r=>cols.map(x=>csvEscape(r[x[1]])).join(','))];
  const {childNet,additiveNet}=childOutContribution(children),live=Number(row?.optimized_live_out_ev||0)+additiveNet,potential=Number(row?.optimized_with_syp_potential_ev||0)+additiveNet;
  const childMeta=children.flatMap(c=>[`Included sealed product,${csvEscape(c.child_product_name)}`,`Quantity,${csvEscape(c.quantity)}`,`TCG Low EV per unit,${csvEscape(c.tcg_low_ev)}`,`Practical liquidation contribution,${csvEscape(Number(c.quantity||0)*Number(c.practical_liquidation_ev||0))}`]);
  const meta=[`Product,${csvEscape(row?.product_name||'')}`,`Sealed acquisition,${csvEscape(row?.sealed_acquisition_price)}`,`Optimized Live Out EV,${csvEscape(live)}`,`Optimized + SYP Potential EV,${csvEscape(potential)}`,`Included sealed products net EV,${csvEscape(childNet)}`,`TCG Regular Net EV (fixed cards only),${csvEscape(row?.tcg_regular_net_ev)}`,`ManaPool Net Est EV (fixed cards only),${csvEscape(row?.manapool_net_est_ev)}`,`CK Cash EV (fixed cards only),${csvEscape(row?.cash_floor_ev??row?.cardkingdom_buylist_ev)}`,...childMeta,''];
  const blob=new Blob([[...meta,...lines].join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${String(row?.product_name||'sealed-out-plan').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()}-out-plan.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function channelMix(rows,key='live_best_channel',evKey='live_best_component_ev',extras=[]){
  const m=new Map();let total=0;
  for(const r of rows){const ch=r[key]||'Unrouted',v=Number(r[evKey]||0);m.set(ch,(m.get(ch)||0)+v);total+=v}
  for(const x of extras){const ch=x.channel||'Unrouted',v=Number(x.ev||0);m.set(ch,(m.get(ch)||0)+v);total+=v}
  return [...m.entries()].map(([channel,ev])=>({channel,ev,share:total>0?100*ev/total:0})).sort((a,b)=>b.ev-a.ev);
}
function stat(label,value,sub='',cls=''){return `<div class="cx-out-opt-stat ${cls}"><span>${esc(label)}</span><b>${value}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function days(r){const d=num(r.estimated_days_to_sell);if(d==null)return '<span class="cx-out-opt-unmeasured">unmeasured</span>';if(d<1)return '&lt;1d';return `${d.toFixed(d<10?1:0)}d`}
function channelClass(ch){return ch==='ManaPool'?'cx-out-opt-slow':''}

function renderPanel(row,rows,children=[]){
  const {childNet,additiveNet,additiveRoutes,alreadyRouted}=childOutContribution(children),childGross=children.reduce((n,c)=>n+Number(c.quantity||0)*Number(c.tcg_low_ev||0),0),live=(num(row.optimized_live_out_ev)||0)+additiveNet,potential=(num(row.optimized_with_syp_potential_ev)||0)+additiveNet,liveMix=channelMix(rows,'live_best_channel','live_best_component_ev',additiveRoutes),top=liveMix[0],acq=num(row.sealed_acquisition_price),cash=num(row.cash_floor_ev??row.cardkingdom_buylist_ev);
  const liveRoi=live!=null&&acq>0?100*(live-acq)/acq:null,potentialRoi=potential!=null&&acq>0?100*(potential-acq)/acq:null,bestProductExit=children.some(c=>c.selected_exit_route==='sell_sealed')?'Best Product Exit':'Optimized Live Out';
  const warning=top&&top.share>=50?`<div class="cx-out-opt-warning"><strong>${esc(top.channel)} concentration:</strong> ${pct(top.share)} of Optimized Live Out EV (${money(top.ev)}) is routed through this one outlet.${top.channel==='ManaPool'?' ManaPool is a materially smaller/slower marketplace than TCGplayer, so this is a dream-routing assumption rather than a fast-liquidation forecast.':''}</div>`:'';
  const uncertainSealed=children.filter(c=>c.selected_exit_route==='sell_sealed'&&c.sealed_route_confidence!=='HIGH'),qualityWarning=uncertainSealed.length?`<div class="cx-out-opt-warning"><strong>Sealed-route depth not fully verified:</strong> ${uncertainSealed.length} selected child route${uncertainSealed.length===1?' uses':'s use'} fresh official pricing or only two public listings. Treat Best Product Exit as provisional.</div>`:'';
  const mix=liveMix.map(x=>`<span class="cx-out-opt-chip ${channelClass(x.channel)}">${esc(x.channel)} · ${money(x.ev)} · ${pct(x.share)}</span>`).join('');
  const body=rows.slice().sort((a,b)=>Number(b.live_best_component_ev||0)-Number(a.live_best_component_ev||0)).map(r=>`<tr><td><strong>${esc(r.card_name)}</strong><br><small>${esc(r.sku_id||'')} · ${esc(r.finish||'')}</small></td><td>${Number(r.quantity||0).toLocaleString()}</td><td class="cx-out-opt-route ${channelClass(r.live_best_channel)}">${esc(r.live_best_channel||'—')}</td><td>${money(r.live_best_unit_net)}</td><td>${money(r.live_best_component_ev)}</td><td>${esc(r.potential_best_channel||'—')}</td><td>${money(r.potential_best_component_ev)}</td><td>${money(r.tcg_direct_live_net)}</td><td>${money(r.tcg_regular_net)}</td><td class="cx-out-opt-slow">${money(r.manapool_net_est)}</td><td>${money(r.ck_cash)}</td><td>${money(r.syp_potential_net_capped)}${r.syp_max_quantity!=null?` <small>×≤${Number(r.syp_max_quantity).toLocaleString()}</small>`:''}</td><td>${r.avg_daily_qty_sold==null?'—':Number(r.avg_daily_qty_sold).toFixed(2)+'/d'}</td><td>${days(r)}</td></tr>`).join('');
  const childRows=children.map(c=>`<div class="cx-out-opt-child"><strong>${Number(c.quantity||0).toLocaleString()} × ${esc(c.child_product_name)}</strong><span>Crack ${money(Number(c.quantity||0)*Number(c.crack_unit_net||0))} · sealed ${money(Number(c.quantity||0)*Number(c.sealed_unit_net||0))}</span><span>${c.selected_exit_route==='sell_sealed'?'Sell sealed':c.selected_exit_route==='crack'?'Crack':String(c.valuation_basis||'').includes('fixed')?'Already routed':'Unresolved'} ${money(Number(c.quantity||0)*Number(c.practical_liquidation_ev||0))}</span><span>${c.selected_exit_route==='sell_sealed'?`${esc(c.sealed_route_confidence||'LOW')} confidence · ${c.sealed_total_listings==null?'depth unverified':`${Number(c.sealed_total_listings).toLocaleString()} listings`} · ${Number(c.sealed_price_age_hours||0).toFixed(1)}h old`:''}</span></div>`).join('');
  return `<section class="cx-out-opt" data-no-detail-swipe><div class="cx-out-opt-head"><div><h4>Out Optimization</h4><p>Outlet-specific fixed-card routing plus one best exit per randomized child: crack it or sell it sealed.</p></div><div class="cx-out-opt-actions"><button type="button" class="cx-out-opt-btn" data-out-export>Export CSV</button></div></div><div class="cx-out-opt-grid">${stat(bestProductExit,money(live),liveRoi==null?'best current routes':`${liveRoi>=0?'+':''}${liveRoi.toFixed(1)}% vs sealed buy`,'cx-out-opt-dream')}${stat('Optimized + SYP',money(potential),potentialRoi==null?'fixed contents only':'fixed contents only · capped SYP','cx-out-opt-potential')}${stat('Included Products Net',money(childNet),children.length?`${money(childGross)} TCG Low EV`:'no sealed children')}${stat('TCG Regular Net',money(row.tcg_regular_net_ev),'fixed cards only')}${stat('ManaPool Net Est',money(row.manapool_net_est_ev),'fixed cards only · slower liquidity')}${stat('CK Cash',money(cash),'fixed cards only')}${stat('SYP Potential',money(row.syp_potential_capped_ev),'fixed cards only')}</div>${childRows?`<div class="cx-out-opt-children">${childRows}</div>`:''}<div class="cx-out-opt-mix">${mix}</div>${qualityWarning}${warning}<div class="cx-out-opt-note">Each randomized child contributes exactly one route: the greater of current crack net or sealed-sale net. TCG Market, SYP, and last-known Direct remain excluded; fixed child cards remain comparison-only.</div><details class="cx-out-opt-details"><summary>View fixed-card routing (${rows.length} lines)</summary><div class="cx-out-opt-table-wrap"><table class="cx-out-opt-table"><thead><tr><th>Card</th><th>Qty</th><th>Live out</th><th>Unit net</th><th>Live EV</th><th>+ SYP route</th><th>Potential EV</th><th>Direct live</th><th>TCG reg</th><th>ManaPool</th><th>CK cash</th><th>SYP potential</th><th>Velocity</th><th>Est. sell</th></tr></thead><tbody>${body}</tbody></table></div></details></section>`;
}

async function attachOptimizer(event){
  const seq=++renderSeq,row=event?.detail?.row,id=event?.detail?.id,children=event?.detail?.data?.children||[];if(!row||!id)return;
  const detail=document.getElementById('cxSealedDetail');if(!detail)return;
  detail.querySelector('.cx-out-opt')?.remove();
  const target=detail.querySelector('.cx-section-title.cx-sealed-econ-title');if(!target)return;
  try{
    const rows=await rest(`sealed_out_optimization_current?select=card_name,sku_id,finish,quantity,tcg_direct_live_net,tcg_regular_net,manapool_net_est,ck_cash,syp_potential_net_capped,syp_max_quantity,avg_daily_qty_sold,estimated_days_to_sell,live_best_channel,live_best_unit_net,live_best_component_ev,potential_best_channel,potential_best_unit_net,potential_best_component_ev&sealed_uuid=eq.${encodeURIComponent(id)}&order=live_best_component_ev.desc`);
    if(seq!==renderSeq||(!rows?.length&&!children.length))return;
    target.insertAdjacentHTML('beforebegin',renderPanel(row,rows,children));
    detail.querySelector('[data-out-export]')?.addEventListener('click',()=>exportCsv(row,rows,children));
  }catch(error){console.warn('[sealed out optimizer]',error)}
}

export function installOutOptimizer(){
  if(installed)return;installed=true;injectStyles();
  document.addEventListener('collectish:sealed-detail-rendered',attachOptimizer);
}
