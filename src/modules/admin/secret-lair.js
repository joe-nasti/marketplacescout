import { rest } from '../../core/rest.js';
import { invokeFunction } from '../../core/functions.js';
import perfectNormal from '../../../data/secret-lair/a-perfectly-normal-superdrop-2026-08-31.json';
import marvelousMathoms from '../../../data/secret-lair/a-marvelous-mathoms-2026-08-17.json';
import mathomsReview from '../../../data/secret-lair/expert-reviews/a-marvelous-mathoms.json';

const LIVE_NAME='Secret Lair: A Perfectly Normal Superdrop';
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=t=>t?new Date(t).toLocaleString():'—';
const age=t=>{if(!t)return'—';const h=(Date.now()-new Date(t).getTime())/36e5;if(h<1)return`${Math.max(1,Math.round(h*60))}m`;if(h<48)return`${Math.round(h)}h`;return`${Math.round(h/24)}d`};
const allowedDims=new Set(['card_quality','anchor_strength','playable_depth','staple_breadth','obscurity','art','treatment','version_of_choice','premium_competition','ip_heat','ip_fit','cute_meme_nostalgia','supply','sale_mechanics','distribution','wait_aversion','promo','bundle','merchandise','value','liquidity','reprint_risk','sell_through','other']);
let busy=false;

function ensure(){
  const host=document.getElementById('cxAdminSinglesModules');if(!host)return null;
  let p=document.getElementById('cxSecretLairAdmin');if(p)return p;
  p=document.createElement('section');p.id='cxSecretLairAdmin';p.className='cx-admin-module';
  p.innerHTML=`<div class="cx-admin-module-head"><div><h3>Secret Lair intelligence</h3><p>One global product supply; US, REU and UK are separately allocated storefronts whose availability can diverge.</p></div><button type="button" data-sl-refresh>Refresh</button></div>
    <div id="cxSecretLairMetrics" class="cx-admin-summary-grid cx-ui-metrics"></div>
    <div class="cx-admin-actions" style="margin:8px 0 10px;display:flex;gap:7px;flex-wrap:wrap">
      <button type="button" data-sl-seed>Seed V1 data</button>
      <button type="button" class="cx-primary" data-sl-research>Freeze Perfectly Normal pre-sale research</button>
    </div>
    <p id="cxSecretLairMessage" class="cx-admin-ia-section-note">Research runs are deliberate: each run uses external web research and creates new immutable research-only snapshots. It never overwrites an earlier pre-sale thesis.</p>
    <div id="cxSecretLairReleases"></div>`;
  host.prepend(p);p.addEventListener('click',click);return p;
}

function metric(label,value,sub,state='neutral'){return `<div class="cx-admin-summary-card cx-ui-metric ${esc(state)}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub||'')}</small></div>`}
function sourceType(url){try{const h=new URL(url).hostname.toLowerCase();if(h.includes('wizards.com'))return'official';if(h.includes('reddit.com'))return'reddit';if(h.includes('youtube.com')||h==='youtu.be')return'youtube';if(/tcgplayer|mtgstocks|cardmarket|tcgstrat/.test(h))return'market';return'article'}catch{return'other'}}
function sourceName(url){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return'Collectish Secret Lair research'}}
function avgConfidence(rows){const a=rows.map(x=>Number(x?.confidence)).filter(Number.isFinite);return a.length?Math.max(0,Math.min(1,a.reduce((s,n)=>s+n,0)/a.length)):0.5}

async function seed(){
  await invokeFunction('secret-lair-import',perfectNormal);
  await invokeFunction('secret-lair-import',marvelousMathoms);
  await invokeFunction('secret-lair-expert-review-import',mathomsReview);
}

async function liveContext(){
  const releases=await rest(`secret_lair_releases?select=release_id,release_name,release_slug,official_url,announced_at,sale_start_at,sale_end_at,sale_format,supply_confidence,supply_notes,preorder_or_queue_notes,promo_notes,bundle_notes,lifecycle_state&release_name=eq.${encodeURIComponent(LIVE_NAME)}&limit=1`,{force:true});
  const release=releases?.[0];if(!release)return null;
  const drops=await rest(`secret_lair_drops?select=drop_id,release_id,drop_name,ip_name,artist_name,treatment_name,nonfoil_msrp,foil_msrp,currency,distribution_notes,wpn_nonfoil,mechanically_unique_count&release_id=eq.${release.release_id}&order=created_at.asc`,{force:true});
  return {release,drops};
}

async function persistResearch(release,drop,result,runAt){
  const rows=(result?.evidence||[]).map(e=>({
    release_id:release.release_id,
    drop_id:drop.drop_id,
    source_type:sourceType(e?.url),
    source_name:sourceName(e?.url),
    source_url:e?.url||null,
    observed_at:runAt,
    evidence_class:['known_fact','observed_signal','speculation','market_state'].includes(e?.evidence_class)?e.evidence_class:'observed_signal',
    claim_dimension:allowedDims.has(e?.claim_dimension)?e.claim_dimension:'other',
    direction:['bullish','bearish','neutral'].includes(e?.direction)?e.direction:'neutral',
    confidence:Number.isFinite(Number(e?.confidence))?Math.max(0,Math.min(1,Number(e.confidence))):0.5,
    summary:String(e?.summary||'').slice(0,3000)||'Research evidence',
    region:['US','REU','UK'].includes(e?.region)?e.region:null,
    metadata:{research_run_at:runAt,model:result?.model||null,research_only:true}
  }));
  if(rows.length)await rest('secret_lair_evidence',{method:'POST',prefer:'return=minimal',body:rows});
  await rest('secret_lair_evaluations',{method:'POST',prefer:'return=minimal',body:[{
    release_id:release.release_id,
    drop_id:drop.drop_id,
    evaluated_at:runAt,
    evaluation_phase:'pre_sale',
    evaluation_status:'research_only',
    confidence:avgConfidence(rows),
    recommendation:'watch',
    thesis:String(result?.answer||'').slice(0,12000)||'Pre-sale research captured; scoring pending.',
    model_version:'secret-lair-v1-research-only',
    score_components:{research_only:true,source_count:Number(result?.sources?.length||0),evidence_count:rows.length,model:result?.model||null,web_search_used:Boolean(result?.web_search_used)}
  }]});
  return rows.length;
}

async function runLiveResearch(){
  let ctx=await liveContext();if(!ctx){await seed();ctx=await liveContext()}if(!ctx)throw new Error('Unable to load the live Secret Lair after seeding.');
  const localByName=new Map((perfectNormal.drops||[]).map(d=>[d.name,d]));
  const msg=document.getElementById('cxSecretLairMessage');let done=0,totalEvidence=0;
  for(const drop of ctx.drops){
    done++;if(msg)msg.textContent=`Researching ${done}/${ctx.drops.length}: ${drop.drop_name}…`;
    const local=localByName.get(drop.drop_name)||{};
    const result=await invokeFunction('secret-lair-research',{
      question:'Create the frozen pre-sale Secret Lair research snapshot. Evaluate collector desirability, business opportunity evidence, treatment/version-of-choice potential, card economics, supply uncertainty, and independent community consensus without using any post-sale outcome.',
      release:{...ctx.release,name:ctx.release.release_name},
      drop:{...drop,cards:local.cards||[],offers:local.offers||[]}
    });
    if(!result?.ok)throw new Error(result?.error||`Research failed for ${drop.drop_name}`);
    totalEvidence+=await persistResearch(ctx.release,drop,result,new Date().toISOString());
  }
  return {drops:done,evidence:totalEvidence};
}

async function click(e){
  if(busy)return;
  const refreshBtn=e.target.closest?.('[data-sl-refresh]');if(refreshBtn){void refresh(true);return}
  const seedBtn=e.target.closest?.('[data-sl-seed]');if(seedBtn){
    busy=true;seedBtn.disabled=true;setMessage('Seeding live + historical Secret Lair data…');
    try{await seed();setMessage('V1 Secret Lair catalogs and historical expert review seeded.');await refresh(true)}catch(err){setMessage(`Seed failed: ${err.message||err}`,true)}finally{busy=false;seedBtn.disabled=false}return;
  }
  const researchBtn=e.target.closest?.('[data-sl-research]');if(researchBtn){
    busy=true;researchBtn.disabled=true;setMessage('Starting pre-sale research…');
    try{const out=await runLiveResearch();setMessage(`Frozen pre-sale research captured for ${out.drops} drops with ${out.evidence} structured evidence rows. Scoring remains pending by design.`);await refresh(true)}catch(err){setMessage(`Research failed: ${err.message||err}`,true)}finally{busy=false;researchBtn.disabled=false}
  }
}
function setMessage(text,error=false){const el=document.getElementById('cxSecretLairMessage');if(el){el.textContent=text;el.classList.toggle('cx-admin-error',error)}}

async function refresh(force=false){
  const p=ensure();if(!p)return;
  const metrics=p.querySelector('#cxSecretLairMetrics'),list=p.querySelector('#cxSecretLairReleases');
  metrics.innerHTML='<div class="cx-empty">Loading Secret Lair intelligence…</div>';list.innerHTML='';
  try{
    const [releases,drops,evals,evidence,regions]=await Promise.all([
      rest('secret_lair_releases?select=release_id,release_name,lifecycle_state,sale_start_at,supply_confidence,updated_at&order=sale_start_at.desc&limit=12',{force}),
      rest('secret_lair_drops?select=drop_id,release_id,drop_name&order=created_at.desc&limit=120',{force}),
      rest('secret_lair_evaluations?select=evaluation_id,release_id,drop_id,evaluated_at,evaluation_phase,evaluation_status,recommendation,opportunity_score,collector_score,confidence&order=evaluated_at.desc&limit=200',{force}),
      rest('secret_lair_evidence?select=evidence_id,release_id,drop_id,source_type,evidence_class,observed_at&order=observed_at.desc&limit=1000',{force}),
      rest('secret_lair_release_regions?select=release_id,region,currency,sale_start_at,allocation_notes,local_demand_notes&order=sale_start_at.desc&limit=50',{force})
    ]);
    const live=releases.find(r=>r.release_name===LIVE_NAME),liveDrops=drops.filter(d=>d.release_id===live?.release_id),liveEvals=evals.filter(x=>x.release_id===live?.release_id),researchOnly=liveEvals.filter(x=>x.evaluation_status==='research_only'),scored=liveEvals.filter(x=>x.evaluation_status==='scored'),liveEvidence=evidence.filter(x=>x.release_id===live?.release_id),liveRegions=regions.filter(x=>x.release_id===live?.release_id);
    const researchedDrops=new Set(researchOnly.map(x=>x.drop_id)).size,scoredDrops=new Set(scored.map(x=>x.drop_id)).size;
    metrics.innerHTML=[metric('Releases',releases.length,'stored catalogs'),metric('Live drops',liveDrops.length,live?'Perfectly Normal':'not seeded',live?'good':'warn'),metric('Research frozen',`${researchedDrops}/${liveDrops.length||8}`,`${liveEvidence.length} evidence rows`,researchedDrops===liveDrops.length&&liveDrops.length?'good':'warn'),metric('Scored',`${scoredDrops}/${liveDrops.length||8}`,'research-only WATCH is not a score',scoredDrops?'good':'neutral'),metric('Regions',liveRegions.length?liveRegions.map(x=>x.region).join(' · '):'—','global supply · regional allocation',liveRegions.length===3?'good':'warn')].join('');
    list.innerHTML=releases.length?releases.map(r=>{
      const ds=drops.filter(d=>d.release_id===r.release_id),es=evals.filter(x=>x.release_id===r.release_id),last=es[0]?.evaluated_at||null,rr=regions.filter(x=>x.release_id===r.release_id).map(x=>x.region).join(' / ');
      return `<div class="cx-admin-list-row"><div><strong>${esc(r.release_name)}</strong><small>${esc(r.lifecycle_state)} · ${ds.length} drops · ${rr||'no regional records'}</small><small>Global supply confidence ${Math.round(Number(r.supply_confidence||0)*100)}% · regional storefront status does not imply global exhaustion</small></div><div><strong>${es.length} snapshots</strong><small>${last?`latest ${esc(age(last))} ago · ${esc(fmt(last))}`:'no evaluation yet'}</small></div></div>`
    }).join(''):'<div class="cx-empty">No Secret Lair catalogs stored for this user yet.</div>';
  }catch(err){metrics.innerHTML=`<div class="cx-admin-error">Couldn’t load Secret Lair intelligence: ${esc(err.message||err)}</div>`}
}

document.addEventListener('collectish:admin-modules-ready',()=>{ensure();void refresh()});
document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles')void refresh()});
window.CollectishSecretLairAdmin={refresh,seed,runLiveResearch};
