import { rest } from '../../core/rest.js';
import { invokeFunction } from '../../core/functions.js';
import perfectNormal from '../../../data/secret-lair/a-perfectly-normal-superdrop-2026-08-31.json';
import marvelousMathoms from '../../../data/secret-lair/a-marvelous-mathoms-2026-08-17.json';
import mathomsReview from '../../../data/secret-lair/expert-reviews/a-marvelous-mathoms.json';
import perfectNormalReview from '../../../data/secret-lair/expert-reviews/a-perfectly-normal-superdrop.json';
import perfectNormalPredictions from '../../../data/secret-lair/predictions/a-perfectly-normal-superdrop-2026-08-31.json';

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
      <button type="button" data-sl-seed>Seed V1 data + predictions</button>
      <button type="button" class="cx-primary" data-sl-research>Freeze pre-sale research</button>
      <button type="button" class="cx-primary" data-sl-score>Score US foil + nonfoil</button>
    </div>
    <p id="cxSecretLairMessage" class="cx-admin-ia-section-note">Pre-sale research, expert predictions and scored snapshots are append-only. Launch observations can confirm or contradict them without rewriting history.</p>
    <div id="cxSecretLairReleases"></div>`;
  host.prepend(p);p.addEventListener('click',click);return p;
}

function metric(label,value,sub,state='neutral'){return `<div class="cx-admin-summary-card cx-ui-metric ${esc(state)}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub||'')}</small></div>`}
function sourceType(url){try{const h=new URL(url).hostname.toLowerCase();if(h.includes('wizards.com'))return'official';if(h.includes('reddit.com'))return'reddit';if(h.includes('youtube.com')||h==='youtu.be')return'youtube';if(/tcgplayer|mtgstocks|cardmarket|tcgstrat/.test(h))return'market';return'article'}catch{return'other'}}
function sourceName(url){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return'Collectish Secret Lair research'}}
function avgConfidence(rows){const a=rows.map(x=>Number(x?.confidence)).filter(Number.isFinite);return a.length?Math.max(0,Math.min(1,a.reduce((s,n)=>s+n,0)/a.length)):0.5}

async function liveContext(){
  const releases=await rest(`secret_lair_releases?select=release_id,release_name,release_slug,official_url,announced_at,sale_start_at,sale_end_at,sale_format,supply_confidence,supply_notes,preorder_or_queue_notes,promo_notes,bundle_notes,lifecycle_state&release_name=eq.${encodeURIComponent(LIVE_NAME)}&limit=1`,{force:true});
  const release=releases?.[0];if(!release)return null;
  const drops=await rest(`secret_lair_drops?select=drop_id,release_id,drop_name,ip_name,artist_name,treatment_name,nonfoil_msrp,foil_msrp,currency,distribution_notes,wpn_nonfoil,mechanically_unique_count&release_id=eq.${release.release_id}&order=created_at.asc`,{force:true});
  return {release,drops};
}

async function seedPredictions(ctx){
  const existing=await rest(`secret_lair_predictions?select=prediction_label&release_id=eq.${ctx.release.release_id}&source_name=eq.${encodeURIComponent(perfectNormalPredictions.source_name)}&limit=100`,{force:true}).catch(()=>[]);
  const labels=new Set((existing||[]).map(x=>x.prediction_label));const byName=new Map(ctx.drops.map(d=>[d.drop_name,d]));const rows=[];
  for(const p of perfectNormalPredictions.predictions||[]){if(labels.has(p.prediction_label))continue;const drop=p.drop_name?byName.get(p.drop_name):null;rows.push({release_id:ctx.release.release_id,drop_id:drop?.drop_id||null,source_type:perfectNormalPredictions.source_type,source_name:perfectNormalPredictions.source_name,prediction_type:p.prediction_type,prediction_label:p.prediction_label,claim:p.claim,predicted_rank:p.predicted_rank??null,predicted_rating:p.predicted_rating??null,predicted_rating_scale:p.predicted_rating_scale??null,confidence:p.confidence??0.5,frozen_at:perfectNormalPredictions.source_observed_at,source_observed_at:perfectNormalPredictions.source_observed_at,metadata:p.metadata||{}})}
  if(rows.length)await rest('secret_lair_predictions',{method:'POST',prefer:'return=minimal',body:rows});return rows.length;
}

async function seed(){
  await invokeFunction('secret-lair-import',perfectNormal);
  await invokeFunction('secret-lair-import',marvelousMathoms);
  await invokeFunction('secret-lair-expert-review-import',mathomsReview);
  await invokeFunction('secret-lair-expert-review-import',perfectNormalReview);
  const ctx=await liveContext();if(ctx)await seedPredictions(ctx);
}

async function persistResearch(release,drop,result,runAt){
  const rows=(result?.evidence||[]).map(e=>({release_id:release.release_id,drop_id:drop.drop_id,source_type:sourceType(e?.url),source_name:sourceName(e?.url),source_url:e?.url||null,observed_at:runAt,evidence_class:['known_fact','observed_signal','speculation','market_state'].includes(e?.evidence_class)?e.evidence_class:'observed_signal',claim_dimension:allowedDims.has(e?.claim_dimension)?e.claim_dimension:'other',direction:['bullish','bearish','neutral'].includes(e?.direction)?e.direction:'neutral',confidence:Number.isFinite(Number(e?.confidence))?Math.max(0,Math.min(1,Number(e.confidence))):0.5,summary:String(e?.summary||'').slice(0,3000)||'Research evidence',region:['US','REU','UK'].includes(e?.region)?e.region:null,metadata:{research_run_at:runAt,model:result?.model||null,research_only:true}}));
  if(rows.length)await rest('secret_lair_evidence',{method:'POST',prefer:'return=minimal',body:rows});
  await rest('secret_lair_evaluations',{method:'POST',prefer:'return=minimal',body:[{release_id:release.release_id,drop_id:drop.drop_id,evaluated_at:runAt,evaluation_phase:'pre_sale',evaluation_status:'research_only',confidence:avgConfidence(rows),recommendation:'watch',thesis:String(result?.answer||'').slice(0,12000)||'Pre-sale research captured; scoring pending.',model_version:'secret-lair-v1-research-only',score_components:{research_only:true,source_count:Number(result?.sources?.length||0),evidence_count:rows.length,model:result?.model||null,web_search_used:Boolean(result?.web_search_used)}}]});return rows.length;
}

async function runLiveResearch(){
  let ctx=await liveContext();if(!ctx){await seed();ctx=await liveContext()}if(!ctx)throw new Error('Unable to load live Secret Lair.');
  const localByName=new Map((perfectNormal.drops||[]).map(d=>[d.name,d]));const msg=document.getElementById('cxSecretLairMessage');let done=0,totalEvidence=0;
  for(const drop of ctx.drops){done++;if(msg)msg.textContent=`Researching ${done}/${ctx.drops.length}: ${drop.drop_name}…`;const local=localByName.get(drop.drop_name)||{};const result=await invokeFunction('secret-lair-research',{question:'Create the frozen pre-sale Secret Lair research snapshot. Evaluate collector desirability, business opportunity evidence, treatment/version-of-choice potential, card economics, supply uncertainty, and independent community consensus without using post-sale outcome.',release:{...ctx.release,name:ctx.release.release_name},drop:{...drop,cards:local.cards||[],offers:local.offers||[]}});if(!result?.ok)throw new Error(result?.error||`Research failed for ${drop.drop_name}`);totalEvidence+=await persistResearch(ctx.release,drop,result,new Date().toISOString())}
  return {drops:done,evidence:totalEvidence};
}

async function runScores(){
  let ctx=await liveContext();if(!ctx){await seed();ctx=await liveContext()}if(!ctx)throw new Error('Unable to load live Secret Lair.');const msg=document.getElementById('cxSecretLairMessage');let scored=0,withheld=0;
  for(const drop of ctx.drops)for(const finish of ['nonfoil','foil']){if(msg)msg.textContent=`Scoring US ${finish}: ${drop.drop_name}…`;const out=await invokeFunction('secret-lair-score',{drop_id:drop.drop_id,region:'US',finish});if(out?.scored)scored++;else withheld++}
  return {scored,withheld,total:ctx.drops.length*2};
}

async function click(e){
  if(busy)return;const refreshBtn=e.target.closest?.('[data-sl-refresh]');if(refreshBtn){void refresh(true);return}
  const seedBtn=e.target.closest?.('[data-sl-seed]');if(seedBtn){busy=true;seedBtn.disabled=true;setMessage('Seeding catalogs, expert evidence and pre-sale predictions…');try{await seed();setMessage('V1 catalogs, expert reviews and prediction ledger seeded.');await refresh(true)}catch(err){setMessage(`Seed failed: ${err.message||err}`,true)}finally{busy=false;seedBtn.disabled=false}return}
  const researchBtn=e.target.closest?.('[data-sl-research]');if(researchBtn){busy=true;researchBtn.disabled=true;setMessage('Starting pre-sale research…');try{const out=await runLiveResearch();setMessage(`Frozen research captured for ${out.drops} drops with ${out.evidence} evidence rows.`);await refresh(true)}catch(err){setMessage(`Research failed: ${err.message||err}`,true)}finally{busy=false;researchBtn.disabled=false}return}
  const scoreBtn=e.target.closest?.('[data-sl-score]');if(scoreBtn){busy=true;scoreBtn.disabled=true;setMessage('Scoring US foil + nonfoil…');try{const out=await runScores();setMessage(`Scored ${out.scored}/${out.total} US drop/finish combinations; ${out.withheld} withheld for missing price or market coverage.`);await refresh(true)}catch(err){setMessage(`Scoring failed: ${err.message||err}`,true)}finally{busy=false;scoreBtn.disabled=false}}
}
function setMessage(text,error=false){const el=document.getElementById('cxSecretLairMessage');if(el){el.textContent=text;el.classList.toggle('cx-admin-error',error)}}

async function refresh(force=false){
  const p=ensure();if(!p)return;const metrics=p.querySelector('#cxSecretLairMetrics'),list=p.querySelector('#cxSecretLairReleases');metrics.innerHTML='<div class="cx-empty">Loading Secret Lair intelligence…</div>';list.innerHTML='';
  try{const [releases,drops,evals,evidence,regions,predictions,observations]=await Promise.all([
    rest('secret_lair_releases?select=release_id,release_name,lifecycle_state,sale_start_at,supply_confidence,updated_at&order=sale_start_at.desc&limit=12',{force}),rest('secret_lair_drops?select=drop_id,release_id,drop_name&order=created_at.desc&limit=120',{force}),rest('secret_lair_evaluations?select=evaluation_id,release_id,drop_id,evaluated_at,evaluation_phase,evaluation_status,recommendation,opportunity_score,collector_score,confidence,region,finish&order=evaluated_at.desc&limit=300',{force}),rest('secret_lair_evidence?select=evidence_id,release_id,drop_id,source_type,evidence_class,observed_at&order=observed_at.desc&limit=1000',{force}),rest('secret_lair_release_regions?select=release_id,region,currency,sale_start_at&order=sale_start_at.desc&limit=50',{force}),rest('secret_lair_predictions?select=prediction_id,release_id,drop_id,prediction_label,prediction_type,frozen_at&order=frozen_at.desc&limit=100',{force}),rest('secret_lair_observations?select=observation_id,release_id,drop_id,region,finish,availability_state,observation_type,observed_at&order=observed_at.desc&limit=300',{force})]);
    const live=releases.find(r=>r.release_name===LIVE_NAME),liveDrops=drops.filter(d=>d.release_id===live?.release_id),liveEvals=evals.filter(x=>x.release_id===live?.release_id),researchOnly=liveEvals.filter(x=>x.evaluation_status==='research_only'),scored=liveEvals.filter(x=>x.evaluation_status==='scored'),liveEvidence=evidence.filter(x=>x.release_id===live?.release_id),liveRegions=regions.filter(x=>x.release_id===live?.release_id),livePred=predictions.filter(x=>x.release_id===live?.release_id),liveObs=observations.filter(x=>x.release_id===live?.release_id);
    const researchedDrops=new Set(researchOnly.map(x=>x.drop_id)).size,scoredPairs=new Set(scored.map(x=>`${x.drop_id}:${x.region}:${x.finish}`)).size;
    metrics.innerHTML=[metric('Live drops',liveDrops.length,live?'Perfectly Normal':'not seeded',live?'good':'warn'),metric('Predictions',livePred.length,'frozen pre-sale claims',livePred.length?'good':'warn'),metric('Research',`${researchedDrops}/${liveDrops.length||8}`,`${liveEvidence.length} evidence rows`,researchedDrops===liveDrops.length&&liveDrops.length?'good':'warn'),metric('Scored pairs',scoredPairs,'region + finish snapshots',scoredPairs?'good':'neutral'),metric('Live observations',liveObs.length,'append-only launch ledger',liveObs.length?'good':'neutral'),metric('Regions',liveRegions.length?liveRegions.map(x=>x.region).join(' · '):'—','global supply · regional allocation',liveRegions.length===3?'good':'warn')].join('');
    list.innerHTML=releases.length?releases.map(r=>{const ds=drops.filter(d=>d.release_id===r.release_id),es=evals.filter(x=>x.release_id===r.release_id),ps=predictions.filter(x=>x.release_id===r.release_id),os=observations.filter(x=>x.release_id===r.release_id),last=es[0]?.evaluated_at||null;return `<div class="cx-admin-list-row"><div><strong>${esc(r.release_name)}</strong><small>${esc(r.lifecycle_state)} · ${ds.length} drops · ${ps.length} predictions · ${os.length} observations</small><small>Global supply confidence ${Math.round(Number(r.supply_confidence||0)*100)}% · regional sellout ≠ global exhaustion</small></div><div><strong>${es.length} snapshots</strong><small>${last?`latest ${esc(age(last))} ago · ${esc(fmt(last))}`:'no evaluation yet'}</small></div></div>`}).join(''):'<div class="cx-empty">No Secret Lair catalogs stored for this user yet.</div>';
  }catch(err){metrics.innerHTML=`<div class="cx-admin-error">Couldn’t load Secret Lair intelligence: ${esc(err.message||err)}</div>`}
}

document.addEventListener('collectish:admin-modules-ready',()=>{ensure();void refresh()});document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles')void refresh()});window.CollectishSecretLairAdmin={refresh,seed,runLiveResearch,runScores,seedPredictions};
