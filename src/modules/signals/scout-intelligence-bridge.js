import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let competitive=[];
let commander=[];
let cedh=[];
let loading=null;
const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function scoutRows(){return store.get().scout?.rows||[]}
function matchScout({sku_id,product_id,card_name,commander}={}){
  const rows=scoutRows();
  if(sku_id){const x=rows.find(r=>String(r.sku_id)===String(sku_id));if(x)return x}
  if(product_id){const x=rows.find(r=>String(r.product_id)===String(product_id));if(x)return x}
  const q=lower(baseName(card_name||commander));if(!q)return null;
  return rows.find(r=>lower(baseName(r.product_name))===q)||rows.find(r=>lower(r.product_name)===q)||null;
}
function openScout(target){
  const row=matchScout(target);if(!row)return;
  window.CollectishShell?.switchPage?.('scout');
  const tryOpen=()=>{
    const input=document.getElementById('cxParitySearch');
    if(input){input.value=baseName(row.product_name);input.dispatchEvent(new Event('input',{bubbles:true}))}
    const card=document.querySelector(`#cxParityCards .cx-scout-card[data-sku="${CSS.escape(String(row.sku_id))}"]`);
    if(card){card.click();card.scrollIntoView({block:'center',behavior:'smooth'});return true}
    return false;
  };
  [40,120,260,500,900].forEach(ms=>setTimeout(tryOpen,ms));
}
function detailFor(row){
  if(!row)return{competitive:[],commander:[],cedh:[]};
  const name=lower(baseName(row.product_name)),pid=String(row.product_id||''),sku=String(row.sku_id||'');
  const comp=competitive.filter(x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid)||lower(baseName(x.card_name))===name);
  const edh=commander.filter(x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid)||lower(baseName(x.card_name))===name);
  const c=cedh.filter(x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid)||lower(baseName(x.commander))===name);
  return{competitive:comp,commander:edh,cedh:c};
}
function badgeSummary(ctx){const out=[];if(ctx.competitive.length)out.push(`COMP ${Math.max(...ctx.competitive.map(x=>Number(x.deck_count_30d||0)))}`);if(ctx.commander.length){const top=ctx.commander[0];out.push(top.watch_class==='edh_breakout'?'EDH ↑':`EDH #${top.edhrec_rank}`)}if(ctx.cedh.length)out.push(`cEDH ${ctx.cedh[0].entries_30d||ctx.cedh[0].entries||0}`);return out}
function decorateScoutList(){
  const bySku=new Map(scoutRows().map(r=>[String(r.sku_id),r]));
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-intelligence-mini')?.remove();
    const row=bySku.get(String(card.dataset.sku)),ctx=detailFor(row),parts=badgeSummary(ctx);if(!parts.length)return;
    const top=card.querySelector('.cx-scout-card-top');if(!top)return;
    const el=document.createElement('span');el.className='cx-intel-mini cx-intelligence-mini';el.textContent=`◎ ${parts.join(' · ')}`;el.title='Competitive / Commander intelligence context; does not change Scout grade';top.appendChild(el);
  });
}
function intelligenceRow(label,value,sub){return `<div class="cx-v5-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function decorateScoutDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;host.querySelector('.cx-intelligence-detail')?.remove();
  const row=scoutRows().find(r=>String(r.sku_id)===String(sku)),ctx=detailFor(row);if(!ctx.competitive.length&&!ctx.commander.length&&!ctx.cedh.length)return;
  const pieces=[];
  if(ctx.competitive.length){const x=ctx.competitive[0];pieces.push(intelligenceRow('Competitive',`${x.deck_count_30d||0} decks · ${x.top8_decks_30d||0} Top 8`,`${x.format||'Competitive'} · PLAYED + SCOUT`))}
  if(ctx.commander.length){const x=ctx.commander[0],trend=x.rank_improvement_pct==null?'baseline':`${Number(x.rank_improvement_pct)>=0?'+':''}${Number(x.rank_improvement_pct).toFixed(0)}% rank move`;pieces.push(intelligenceRow('EDHREC',`#${x.edhrec_rank||'—'} · ${trend}`,`${String(x.watch_class||'').replace(/_/g,' ')} · ${x.edhrec_signal||'Commander demand'}`))}
  if(ctx.cedh.length){const x=ctx.cedh[0];pieces.push(intelligenceRow('cEDH commander',`${x.entries_30d||x.entries||0} entries · ${x.top16_entries||0} Top 16`,x.share_30d_pct!=null?`${x.share_30d_pct}% recent tournament share`:'Tournament baseline'))}
  const section=document.createElement('section');section.className='cx-v5-section cx-intelligence-detail';section.innerHTML=`<div class="cx-section-title">Market intelligence <span class="cx-intel-context">context only</span></div><div class="cx-v5-grid">${pieces.join('')}</div><small class="cx-sub">Signals, competitive play, EDHREC and cEDH context do not change the Scout grade yet.</small>`;
  const anchor=host.querySelector('.cx-v5-components')||host.firstElementChild;if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}
function decorateSignalsLinks(){
  const candidates=[...document.querySelectorAll('#cxSignalsFeed .cx-signal-entities span,#cxCompetitiveIntel .cx-detail-stat')];
  for(const el of candidates){
    if(el.dataset.scoutLinked==='1')continue;
    let name='';
    if(el.matches('.cx-signal-entities span'))name=el.textContent.replace(/\s*✓\s*$/,'').trim();
    else name=el.querySelector('strong')?.textContent?.trim()||'';
    const row=matchScout({card_name:name});if(!row)continue;
    el.dataset.scoutLinked='1';el.setAttribute('role','button');el.setAttribute('tabindex','0');el.title='Open this card in Scout';el.classList.add('cx-scout-deep-link');
    el.addEventListener('click',e=>{if(e.target.closest('a,button'))return;openScout({sku_id:row.sku_id})});
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openScout({sku_id:row.sku_id})}});
  }
}
async function load(){
  if(loading)return loading;
  loading=Promise.allSettled([
    rest('rpc/competitive_scout_opportunities',{method:'POST',body:{p_format:null}}),
    rest('rpc/commander_edh_opportunities',{method:'POST',body:{p_limit:150}}),
    rest('rpc/cedh_commander_rollups',{method:'POST',body:{p_days:90,p_min_event_size:16}})
  ]).then(([a,b,c])=>{competitive=a.status==='fulfilled'&&Array.isArray(a.value)?a.value:[];commander=b.status==='fulfilled'&&Array.isArray(b.value)?b.value:[];cedh=c.status==='fulfilled'&&Array.isArray(c.value)?c.value:[];decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku||null);decorateSignalsLinks()}).finally(()=>{loading=null});
  return loading;
}

document.addEventListener('collectish:scout-list-rendered',()=>{if(competitive.length||commander.length||cedh.length)decorateScoutList();else void load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(competitive.length||commander.length||cedh.length)decorateScoutDetail(e.detail?.sku);else void load()});
document.addEventListener('collectish:intel-changed',()=>setTimeout(decorateSignalsLinks,0));
document.addEventListener('collectish:competitive-changed',()=>{loading=null;void load()});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(decorateSignalsLinks,60)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(decorateSignalsLinks,80)});
document.addEventListener('collectish:open-scout-card',e=>openScout(e.detail||{}));
document.addEventListener('collectish:ready',()=>void load());

void load();
export { openScout as openScoutIntelligenceCard, load as loadScoutIntelligenceContext };
