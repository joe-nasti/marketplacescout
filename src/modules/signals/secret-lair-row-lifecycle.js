import { rest } from '../../core/rest.js';

const LIVE_NAME='Secret Lair: A Perfectly Normal Superdrop';
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=n=>`${Math.round(Number(n||0)*100)}%`;
const fmt=t=>t?new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';

function style(){
  if(document.getElementById('cxSlRowLifecycleStyle'))return;
  const s=document.createElement('style');
  s.id='cxSlRowLifecycleStyle';
  s.textContent=`
  .cx-sl-rowlife{margin-top:7px;border-top:1px solid var(--color-border);padding-top:7px}
  .cx-sl-rowlife-head{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
  .cx-sl-rowlife-head strong{font-size:8px;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-secondary)}
  .cx-sl-rowlife-head span{font-size:8px;color:var(--color-text-secondary)}
  .cx-sl-rowlife-finishes{display:grid;grid-template-columns:1fr 1fr;gap:7px}
  .cx-sl-rowlife-finish{border:1px solid var(--color-border);border-radius:8px;padding:6px 7px;background:var(--color-bg-primary)}
  .cx-sl-rowlife-top{display:flex;justify-content:space-between;gap:6px;align-items:center;margin-bottom:5px}
  .cx-sl-rowlife-top b{font-size:8px}.cx-sl-rowlife-top span{font-size:7.5px;color:var(--color-text-secondary)}
  .cx-sl-rail{display:grid;grid-template-columns:repeat(5,1fr);position:relative;gap:0;padding-top:2px}
  .cx-sl-rail:before{content:'';position:absolute;left:8%;right:8%;top:7px;height:1px;background:var(--color-border)}
  .cx-sl-node{position:relative;z-index:1;text-align:center;font-size:6.8px;color:var(--color-text-secondary);min-width:0}
  .cx-sl-node i{display:block;width:8px;height:8px;border-radius:50%;margin:0 auto 3px;background:var(--color-bg-surface);border:2px solid var(--color-border)}
  .cx-sl-node[data-done='1'] i{background:var(--color-accent);border-color:var(--color-accent)}
  .cx-sl-node[data-current='1']{color:var(--color-accent);font-weight:900}.cx-sl-node[data-current='1'] i{box-shadow:0 0 0 2px var(--color-accent-soft)}
  .cx-sl-rowlife-foot{display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:7.5px;color:var(--color-text-secondary)}
  @media(max-width:700px){.cx-sl-rowlife-finishes{grid-template-columns:1fr}.cx-sl-node{font-size:7px}}
  `;
  document.head.appendChild(s);
}

function stage(s){
  if(s?.first_five_listings_at)return 4;
  if(s?.first_three_sellers_at)return 3;
  if(s?.first_sale_at)return 2;
  if(s?.first_listing_at)return 1;
  return 0;
}

function finishCard(label,s){
  s=s||{};const st=stage(s);const listings=Number(s.latest_listing_count||0),sellers=Number(s.latest_seller_count||0),peak=Number(s.peak_listing_count||0),score=Number(s.product_transition_score||0);
  const nodes=[['SL sale',true],['1st listing',!!s.first_listing_at],['1st sale',!!s.first_sale_at],['3 sellers',!!s.first_three_sellers_at],['5 listings',!!s.first_five_listings_at]];
  const state=st===0?'Waiting':st===1?'Presale activity':st===2?'Sales started':st===3?'Seller spread':st===4?'Supply building':'Observing';
  return `<div class="cx-sl-rowlife-finish"><div class="cx-sl-rowlife-top"><b>${esc(label)}</b><span>${esc(state)} · transition ${esc(pct(score))}</span></div><div class="cx-sl-rail">${nodes.map((n,i)=>`<div class="cx-sl-node" data-done="${n[1]?1:0}" data-current="${i===st?1:0}" title="${i===1?esc(fmt(s.first_listing_at)):i===2?esc(fmt(s.first_sale_at)):i===3?esc(fmt(s.first_three_sellers_at)):i===4?esc(fmt(s.first_five_listings_at)):''}"><i></i>${esc(n[0])}</div>`).join('')}</div><div class="cx-sl-rowlife-foot"><span>${listings} listings · ${sellers} sellers</span><span>peak ${peak}</span></div></div>`;
}

function findArticle(name){
  const articles=[...document.querySelectorAll('#cxSecretLairSignals .cx-sl-drop')];
  return articles.find(a=>a.querySelector('.cx-sl-title strong')?.textContent?.trim()===name)||null;
}

async function render(){
  const host=document.getElementById('cxSecretLairSignals');if(!host)return;
  try{
    const releases=await rest(`secret_lair_releases?select=release_id&release_name=eq.${encodeURIComponent(LIVE_NAME)}&limit=1`),r=releases?.[0];if(!r)return;
    const [drops,states]=await Promise.all([
      rest(`secret_lair_drops?select=drop_id,drop_name&release_id=eq.${r.release_id}&order=created_at.asc`),
      rest(`secret_lair_market_transition_state?select=drop_id,finish,first_listing_at,first_sale_at,first_three_sellers_at,first_five_listings_at,latest_listing_count,latest_seller_count,peak_listing_count,product_transition_score&release_id=eq.${r.release_id}`)
    ]);
    const sm=new Map((states||[]).map(x=>[`${x.drop_id}:${x.finish}`,x]));
    for(const d of drops||[]){
      const article=findArticle(d.drop_name);if(!article)continue;
      let box=article.querySelector('.cx-sl-rowlife');if(!box){box=document.createElement('section');box.className='cx-sl-rowlife';const row=article.querySelector('.cx-sl-row');row?.insertAdjacentElement('afterend',box)}
      const nf=sm.get(`${d.drop_id}:nonfoil`)||{},fo=sm.get(`${d.drop_id}:foil`)||{};
      const active=Number(nf.latest_listing_count||0)+Number(fo.latest_listing_count||0)>0;
      box.innerHTML=`<div class="cx-sl-rowlife-head"><strong>TCG lifecycle</strong><span>${active?'market activity detected':'cataloged · waiting for sellers'}</span></div><div class="cx-sl-rowlife-finishes">${finishCard('Nonfoil',nf)}${finishCard('Foil',fo)}</div>`;
    }
  }catch{}
}

export async function install(){style();await render();document.addEventListener('collectish:intel-changed',()=>setTimeout(()=>void render(),0))}
