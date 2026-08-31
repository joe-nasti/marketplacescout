import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, x-collectish-cron-key, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};const H=(t:string,api=A)=>({apikey:api,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:H(t)});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={},api=A){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t,api),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function cronOk(key:string){if(!key)return false;const x=await rest(S,'rpc/verify_collectish_cron_key',{method:'POST',body:{p_key:key}},S).catch(()=>false);return x===true}
function firstSold(rows:any[],dropId:string|null){return rows.filter(r=>(!dropId||r.drop_id===dropId)&&r.availability_state==='sold_out').sort((a,b)=>Number(a.elapsed_minutes_from_sale??1e9)-Number(b.elapsed_minutes_from_sale??1e9))[0]||null}
function latestForDrop(rows:any[],dropId:string){return rows.filter(r=>r.drop_id===dropId).sort((a,b)=>new Date(b.observed_at).getTime()-new Date(a.observed_at).getTime())[0]||null}
function priorNote(drop:any){if(!drop)return'unknown starting-supply prior';const p=String(drop.supply_prior||'unknown').replaceAll('_',' '),c=Math.round(Number(drop.supply_prior_confidence||0)*100);return `${p} starting-supply prior${c?` (${c}% confidence)`:''}`}
function judge(pred:any,obs:any[],dropMap:Map<string,any>){
  const sold=obs.filter(r=>r.drop_id&&r.availability_state==='sold_out'&&Number.isFinite(Number(r.elapsed_minutes_from_sale))),distinct=new Map();for(const r of sold){const old=distinct.get(r.drop_id);if(!old||Number(r.elapsed_minutes_from_sale)<Number(old.elapsed_minutes_from_sale))distinct.set(r.drop_id,r)}
  const ordered=[...distinct.values()].sort((a:any,b:any)=>Number(a.elapsed_minutes_from_sale)-Number(b.elapsed_minutes_from_sale)),dropSold=pred.drop_id?firstSold(obs,pred.drop_id):null;
  if(pred.prediction_type==='sellout_speed'){
    const w30=ordered.filter((r:any)=>Number(r.elapsed_minutes_from_sale)<=30).length,w60=ordered.filter((r:any)=>Number(r.elapsed_minutes_from_sale)<=60).length,first:any=ordered[0],firstDrop=first?dropMap.get(first.drop_id):null;
    if(w60>=2)return['strong_support',`${w60} distinct drops were confirmed sold out within 60 minutes (${w30} within 30). Starting allocations are not assumed equal.`];
    if(w60>=1){const extra=firstDrop&&['high','very_high'].includes(firstDrop.supply_prior)?` The first confirmed sellout carried a ${priorNote(firstDrop)}, making the relative-demand signal stronger despite unknown exact units.`:'';return['early_support',`${w60} drop was confirmed sold out within 60 minutes; fast-sellout thesis has early support.${extra}`]}
    const latest=Math.max(0,...obs.map(r=>Number(r.elapsed_minutes_from_sale)||0));if(latest>=120&&!ordered.length)return['contradicted','Two hours of launch observations without a confirmed sold-out drop contradict the fast-sellout thesis.'];return['not_enough_evidence','No decisive sellout-speed evidence yet.'];
  }
  if(['favorite','rating','resale_opportunity'].includes(pred.prediction_type)){
    const drop=pred.drop_id?dropMap.get(pred.drop_id):null;
    if(pred.drop_id&&dropSold){const rank=ordered.findIndex((r:any)=>r.drop_id===pred.drop_id)+1,prior=priorNote(drop);if(rank===1){const stronger=drop&&['high','very_high'].includes(drop.supply_prior)?' This is stronger relative-demand evidence because the drop had a high qualitative starting-supply prior.':'';return['strong_support',`Predicted drop was the first confirmed sellout, by T+${dropSold.elapsed_minutes_from_sale}m, with a ${prior}.${stronger} Exact starting units remain unknown.`]}if(rank>0&&rank<=3)return['early_support',`Predicted drop was among the first ${rank} confirmed sellouts, by T+${dropSold.elapsed_minutes_from_sale}m, against a ${prior}.`];return['mixed',`Predicted drop sold out, but only after ${rank-1} other drops. Supply priors differ, so raw sellout rank is not treated as pure popularity.`]}
    if(pred.drop_id){const latest=latestForDrop(obs,pred.drop_id),soldOthers=ordered.length;if(latest?.availability_state==='available'&&soldOthers>=3)return['contradicted',`${soldOthers} other drops sold out while the predicted drop remained available; interpretation is moderated by differing starting-supply priors.`];if(soldOthers)return['mixed',`${soldOthers} other drop${soldOthers===1?'':'s'} sold out; predicted drop has not yet sold out. Starting allocations are not assumed equal.`]}
  }
  if(pred.prediction_type==='bundle_strategy'){const bundleSold=obs.filter(r=>r.observation_type==='bundle_status'&&r.availability_state==='sold_out');return bundleSold.length?['early_support',`${bundleSold.length} bundle storefront offer${bundleSold.length===1?'':'s'} sold out; bundle-demand thesis has launch support.`]:['not_enough_evidence','Bundle-strategy outcome requires bundle sell-through observations.']}
  return['not_enough_evidence','No deterministic launch rule applies yet.'];
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return J({error:'POST required'},405);
  const cronKey=req.headers.get('x-collectish-cron-key')||'',cronMode=await cronOk(cronKey);let token='',api=A,u:any=null;if(cronMode){token=S;api=S}else{token=bearer(req);if(!token)return J({error:'Authentication required'},401);try{u=await auth(token)}catch{return J({error:'Authentication required'},401)}}
  let b:any;try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}const releaseId=String(b?.release_id||'');if(!releaseId)return J({error:'release_id required'},400);
  try{
    if(cronMode){const rel=await rest(token,`secret_lair_releases?select=user_id&release_id=eq.${encodeURIComponent(releaseId)}&limit=1`,{},api);u={id:rel?.[0]?.user_id};if(!u.id)throw Error('Release not found')}
    const predIds=await rest(token,`secret_lair_predictions?select=prediction_id&release_id=eq.${encodeURIComponent(releaseId)}`,{},api),ids=(predIds||[]).map((p:any)=>p.prediction_id).join(',')||'00000000-0000-0000-0000-000000000000';
    const [preds,obs,existing,drops]=await Promise.all([
      rest(token,`secret_lair_predictions?select=prediction_id,drop_id,prediction_type,prediction_label,claim,metadata&release_id=eq.${encodeURIComponent(releaseId)}&order=frozen_at.asc`,{},api),
      rest(token,`secret_lair_observations?select=observation_id,drop_id,bundle_offer_id,region,finish,availability_state,observation_type,observed_at,elapsed_minutes_from_sale&release_id=eq.${encodeURIComponent(releaseId)}&order=observed_at.asc`,{},api),
      rest(token,`secret_lair_prediction_updates?select=prediction_id,confirmation_state,observed_at&prediction_id=in.(${ids})&order=observed_at.desc`,{},api).catch(()=>[]),
      rest(token,`secret_lair_drops?select=drop_id,drop_name,supply_prior,supply_prior_confidence,supply_prior_rationale&release_id=eq.${encodeURIComponent(releaseId)}`,{},api)
    ]);
    const dropMap=new Map((drops||[]).map((d:any)=>[d.drop_id,d])),last=new Map();for(const x of existing||[])if(!last.has(x.prediction_id))last.set(x.prediction_id,x);
    const rows=[];for(const p of preds||[]){const [state,summary]=judge(p,obs||[],dropMap),prev=last.get(p.prediction_id);if(prev?.confirmation_state===state)continue;rows.push({user_id:u.id,prediction_id:p.prediction_id,confirmation_state:state,evidence_summary:summary,observation_ids:(obs||[]).slice(-25).map((o:any)=>o.observation_id),metadata:{rule_version:'secret-lair-launch-v1.2-supply-prior',cron_mode:cronMode,supply_units_inferred:false}})}
    if(rows.length)await rest(token,'secret_lair_prediction_updates',{method:'POST',prefer:'return=minimal',body:rows},api);
    return J({ok:true,predictions:(preds||[]).length,updates_written:rows.length,cron_mode:cronMode,states:rows.map(r=>({prediction_id:r.prediction_id,state:r.confirmation_state,summary:r.evidence_summary}))});
  }catch(e){return J({error:(e as Error).message},502)}
});
