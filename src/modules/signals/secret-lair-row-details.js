import { rest } from '../../core/rest.js';

const LIVE_NAME='Secret Lair: A Perfectly Normal Superdrop';
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=t=>t?new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';

function style(){
  if(document.getElementById('cxSlRowDetailsStyle'))return;
  const s=document.createElement('style');
  s.id='cxSlRowDetailsStyle';
  s.textContent=`
  .cx-sl-deep{margin-top:7px;border-top:1px solid var(--color-border);padding-top:6px}
  .cx-sl-deep>summary{display:flex;justify-content:space-between;gap:8px;align-items:center;cursor:pointer;list-style:none;font-size:8.5px;font-weight:900;color:var(--color-accent)}
  .cx-sl-deep>summary::-webkit-details-marker{display:none}.cx-sl-deep>summary:after{content:'›';font-size:14px;line-height:1;transform:rotate(90deg);transition:transform .15s ease}.cx-sl-deep[open]>summary:after{transform:rotate(-90deg)}
  .cx-sl-deep-summary{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.cx-sl-deep-count{font-size:7.5px;color:var(--color-text-secondary);font-weight:700}
  .cx-sl-deep-body{display:grid;gap:8px;margin-top:8px}.cx-sl-deep-panel{border:1px solid var(--color-border);border-radius:8px;padding:7px 8px;background:var(--color-bg-primary)}
  .cx-sl-deep-panel h5{font-size:7.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-secondary);margin:0 0 5px}.cx-sl-deep-panel p{font-size:8.5px;line-height:1.45;margin:0;color:var(--color-text-secondary)}
  .cx-sl-alerts{display:grid;gap:5px}.cx-sl-alert{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px;align-items:start;font-size:8px;padding-top:5px;border-top:1px solid var(--color-border)}.cx-sl-alert:first-child{border-top:0;padding-top:0}
  .cx-sl-alert-dot{width:6px;height:6px;border-radius:50%;margin-top:3px;background:var(--color-accent)}.cx-sl-alert[data-severity='warning'] .cx-sl-alert-dot{background:var(--color-warning,var(--color-accent))}.cx-sl-alert b{display:block;font-size:8.5px}.cx-sl-alert span{color:var(--color-text-secondary);line-height:1.35}.cx-sl-alert time{font-size:7px;color:var(--color-text-secondary);white-space:nowrap}
  .cx-sl-deep .cx-sl-images,.cx-sl-deep .cx-sl-finishdetail{margin-top:0;border-top:0;padding-top:0}.cx-sl-deep .cx-sl-images summary,.cx-sl-deep .cx-sl-finishdetail summary{font-size:8.5px}
  @media(max-width:700px){.cx-sl-alert{grid-template-columns:auto minmax(0,1fr)}.cx-sl-alert time{grid-column:2}}
  `;
  document.head.appendChild(s);
}

function findArticle(name){
  return [...document.querySelectorAll('#cxSecretLairSignals .cx-sl-drop')].find(a=>a.querySelector('.cx-sl-title strong')?.textContent?.trim()===name)||null;
}

function alertRows(rows){
  if(!rows.length)return '<p>No marketplace milestone alerts for this drop yet.</p>';
  return `<div class="cx-sl-alerts">${rows.slice(0,6).map(a=>`<div class="cx-sl-alert" data-severity="${esc(a.severity||'info')}"><i class="cx-sl-alert-dot"></i><div><b>${esc(a.title)}</b><span>${esc(a.message)}</span></div><time>${esc(fmt(a.last_seen_at||a.first_seen_at))}</time></div>`).join('')}</div>`;
}

function ensureDrawer(article,d,expert,alerts){
  let drawer=article.querySelector(':scope > .cx-sl-deep');
  const existing=[...article.querySelectorAll(':scope > .cx-sl-images, :scope > .cx-sl-finishdetail')];
  if(!drawer){
    drawer=document.createElement('details');
    drawer.className='cx-sl-deep';
    article.appendChild(drawer);
  }
  const wasOpen=drawer.open;
  drawer.innerHTML=`<summary><span class="cx-sl-deep-summary"><span>Why / details</span><span class="cx-sl-deep-count">${alerts.length?`${alerts.length} market alert${alerts.length===1?'':'s'} · `:''}thesis · provenance · official images</span></span></summary><div class="cx-sl-deep-body"><section class="cx-sl-deep-panel"><h5>Why this call</h5><p>${esc(expert?.summary||'No expert-review summary attached to this drop yet.')}</p></section><section class="cx-sl-deep-panel"><h5>Supply prior</h5><p>${esc(d.supply_prior_rationale||'Qualitative starting-supply prior only; exact starting units are unknown and are not inferred.')}</p></section><section class="cx-sl-deep-panel"><h5>Market alerts</h5>${alertRows(alerts)}</section><div class="cx-sl-deep-extra"></div></div>`;
  const extra=drawer.querySelector('.cx-sl-deep-extra');
  for(const node of existing)extra?.appendChild(node);
  drawer.open=wasOpen;
}

async function render(){
  if(!document.getElementById('cxSecretLairSignals'))return;
  try{
    const releases=await rest(`secret_lair_releases?select=release_id&release_name=eq.${encodeURIComponent(LIVE_NAME)}&limit=1`),r=releases?.[0];if(!r)return;
    const [drops,evidence,alerts]=await Promise.all([
      rest(`secret_lair_drops?select=drop_id,drop_name,supply_prior_rationale&release_id=eq.${r.release_id}&order=created_at.asc`),
      rest(`secret_lair_evidence?select=drop_id,summary,raw_rating,raw_rating_scale,observed_at&release_id=eq.${r.release_id}&source_type=eq.expert_review&order=observed_at.desc&limit=200`).catch(()=>[]),
      rest('collectish_alerts?select=id,title,message,severity,first_seen_at,last_seen_at,metadata_json&category=eq.business&resolved_at=is.null&order=last_seen_at.desc&limit=100').catch(()=>[])
    ]);
    for(const d of drops||[]){
      const article=findArticle(d.drop_name);if(!article)continue;
      const expert=(evidence||[]).find(x=>x.drop_id===d.drop_id);
      const rows=(alerts||[]).filter(a=>String(a?.metadata_json?.release_id||'')===String(r.release_id)&&String(a?.metadata_json?.drop_id||'')===String(d.drop_id));
      ensureDrawer(article,d,expert,rows);
    }
  }catch{}
}

export async function install(){style();await render();document.addEventListener('collectish:intel-changed',()=>setTimeout(()=>void render(),30))}
