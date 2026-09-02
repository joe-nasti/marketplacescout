import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const SCALEFAST='https://eu-api.scalefast.com';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-collectish-cron-key, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function cronOk(key:string){if(!key)return false;const x=await rest('rpc/verify_collectish_cron_key',{method:'POST',body:{p_key:key}}).catch(()=>false);return x===true}
function htmlClassify(html:string,status:number){if(status>=400)return{state:'unknown',reason:`page_http_${status}`};const lower=html.toLowerCase();if(/sale cancelled|sale canceled/.test(lower))return{state:'pulled',reason:'page_sale_cancelled'};if(/ng-init=["'][^"']*init\([^)]*["']sold_out["']/i.test(html))return{state:'sold_out',reason:'page_embedded_sold_out'};if(/no longer available|waiting list/.test(lower))return{state:'sold_out',reason:'page_no_longer_available'};if(/low stock/.test(lower))return{state:'low_stock',reason:'page_low_stock'};if(/add to cart|preorder now|pre-order now/.test(lower))return{state:'available',reason:'page_add_to_cart'};return{state:'unknown',reason:'page_no_state_marker'}}
function elapsed(start:string|null,at:string){if(!start)return null;const n=Math.round((new Date(at).getTime()-new Date(start).getTime())/60000);return Number.isFinite(n)?n:null}
function cadence(t:any,state:string,stableChecks:number){
  const start=t.sale_start_at?new Date(t.sale_start_at).getTime():NaN,age=Number.isFinite(start)?(Date.now()-start)/60000:null;
  let base=15,cap=360;
  if(state==='pulled')return null;
  else if(state==='unknown'){base=15;cap=360}
  else if(state==='sold_out'){
    if(age!==null&&age<360){base=15;cap=60}
    else if(age!==null&&age<4320){base=30;cap=180}
    else if(age!==null&&age<20160){base=60;cap=720}
    else if(age!==null&&age<43200){base=180;cap=1440}
    else{base=1440;cap=10080}
  }else if(state==='low_stock'){base=2;cap=10}
  else if(age!==null&&age<0){
    const until=-age;if(until>43200){base=cap=1440}else if(until>10080){base=720;cap=1440}else if(until>1440){base=180;cap=720}else if(until>60){base=30;cap=120}else{base=5;cap=15}
  }else if(age!==null&&age<30){base=2;cap=5}
  else if(age!==null&&age<120){base=5;cap=15}
  else if(age!==null&&age<1440){base=15;cap=60}
  else if(age!==null&&age<10080){base=60;cap=360}
  else if(age!==null&&age<43200){base=360;cap=1440}
  else{base=cap=1440}
  return Math.max(2,Math.min(cap,base*Math.pow(2,Math.min(stableChecks,6))));
}
function watchTable(t:any){return t.kind==='bundle'?{table:'secret_lair_bundle_offers',key:'bundle_offer_id'}:t.kind==='randomized'?{table:'secret_lair_randomized_product_offers',key:'randomized_product_offer_id'}:{table:'secret_lair_drop_offers',key:'offer_id'}}
async function digest(value:any){const bytes=new TextEncoder().encode(JSON.stringify(value));const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function pageMetadata(html:string){
  const title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g,' ').trim()||null,json_ld:any[]=[];
  for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{json_ld.push(JSON.parse(m[1]))}catch{}if(json_ld.length>=12)break}
  return{title,json_ld,content_length:html.length};
}
async function snapshot(t:any,result:any,at:string){
  const source=result.product_payload?'scalefast_product_api':'official_storefront_page',payload=result.product_payload||{},page=result.page_metadata||{},content_hash=await digest({payload,page,state:result.state,reason:result.reason});
  const wt=watchTable(t),offerFilter=`${wt.key}=eq.${encodeURIComponent(t.id)}`;
  const existing=await rest(`secret_lair_storefront_snapshots?select=storefront_snapshot_id&${offerFilter}&capture_source=eq.${source}&content_hash=eq.${content_hash}&limit=1`).catch(()=>[]);
  if(existing?.length)return false;
  const row:any={user_id:t.user_id,release_id:t.release_id,offer_id:t.kind==='drop'?t.id:null,bundle_offer_id:t.kind==='bundle'?t.id:null,randomized_product_offer_id:t.kind==='randomized'?t.id:null,region:t.region,captured_at:at,capture_source:source,availability_state:result.state,api_status:result.api_status||null,api_state:result.api_state||null,waiting_list:result.waiting_list,source_url:t.product_url,content_hash,payload,page_metadata:page};
  await rest('secret_lair_storefront_snapshots',{method:'POST',prefer:'return=minimal',body:[row]}).catch(e=>{if(!String(e).toLowerCase().includes('duplicate'))throw e});return true;
}
async function alert(r:any,suffix:string,severity:string,title:string,message:string,metadata:any){
  const alert_key=`secret_lair:launch_integrity:${suffix}:${r.release_id}`;
  await rest('collectish_alerts?on_conflict=user_id,alert_key',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:[{user_id:r.user_id,alert_key,category:'operational',severity,title,message,action_screen:'signals',metadata_json:{release_id:r.release_id,release_name:r.release_name,event:`launch_integrity_${suffix}`,...metadata},last_seen_at:new Date().toISOString(),resolved_at:null,updated_at:new Date().toISOString()}]});
}
async function resolveAlert(r:any,suffix:string){await rest(`collectish_alerts?user_id=eq.${encodeURIComponent(r.user_id)}&alert_key=eq.${encodeURIComponent(`secret_lair:launch_integrity:${suffix}:${r.release_id}`)}&resolved_at=is.null`,{method:'PATCH',prefer:'return=minimal',body:{resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()}}).catch(()=>null)}
async function assessIntegrity(r:any,offers:any[]){
  const start=r.sale_start_at?new Date(r.sale_start_at).getTime():NaN,now=Date.now(),insideWindow=!Number.isFinite(start)||now>=start-1440*60000;
  const active=offers.filter(x=>!x.watch_stopped_at),incomplete=active.filter(x=>!x.product_url||!x.external_product_id),configured=active.length-incomplete.length;
  if(!insideWindow){await Promise.all([resolveAlert(r,'targets'),resolveAlert(r,'observations')]);return{release_id:r.release_id,modeled:offers.length,configured,incomplete:incomplete.length,window:'future'}}
  if(!offers.length)await alert(r,'targets','critical','Secret Lair launch has no monitor targets',`${r.release_name} is within 24 hours of launch but has no modeled storefront offers.`,{modeled_offers:0,configured_targets:0});
  else if(incomplete.length)await alert(r,'targets','critical','Secret Lair launch targets are incomplete',`${r.release_name} has ${incomplete.length} offer${incomplete.length===1?'':'s'} missing a storefront URL or product ID.`,{modeled_offers:offers.length,configured_targets:configured,incomplete_targets:incomplete.map(x=>({kind:x.kind,region:x.region,id:x.id,has_url:Boolean(x.product_url),has_product_id:Boolean(x.external_product_id)}))});
  else await resolveAlert(r,'targets');
  if(Number.isFinite(start)&&now>=start+5*60000&&configured>0){
    const observations=await rest(`secret_lair_observations?select=observation_id&release_id=eq.${encodeURIComponent(r.release_id)}&limit=1`).catch(()=>[]);
    if(!observations?.length)await alert(r,'observations','critical','Secret Lair launch has no observations',`${r.release_name} launched more than five minutes ago but has no availability observation.`,{sale_start_at:r.sale_start_at,configured_targets:configured});else await resolveAlert(r,'observations');
  }
  return{release_id:r.release_id,modeled:offers.length,configured,incomplete:incomplete.length,stopped:offers.length-active.length};
}
async function cartState(productId:string,productUrl:string){
  let apiStatus=0,api:any=null,apiError='';
  try{const fields='productID,waiting_list,state,stock,limit_purchase,creation_date,release_date,price_info,specific,extension,custom_fields';const r=await fetch(`${SCALEFAST}/product/${encodeURIComponent(productId)}?fields=${fields}`,{headers:{accept:'application/json','user-agent':'CollectishSecretLairWatch/1.2'}});apiStatus=r.status;api=await r.json()}catch(e){apiError=String((e as Error).message||e)}
  const ok=apiStatus===200&&api?.result?.status==='OK'&&api?.response_data?.productID;
  if(ok){
    const state=String(api.response_data.state||'').toUpperCase(),waiting=api.response_data.waiting_list===true||String(api.response_data.waiting_list).toLowerCase()==='true';
    const p=api.response_data,meta={stock:p.stock??null,limit_purchase:p.limit_purchase??null,creation_date:p.creation_date??null,release_date:p.release_date??null,price_info:p.price_info??null,provider_id:p.specific?.extension?.custom?.id_to_use_with_provider??null,refid:p.extension?.refid??null,custom_fields:p.custom_fields??null};
    if(waiting)return{state:'sold_out',reason:'cart_waiting_list',api_status:apiStatus,api_state:state,waiting_list:true,api_error:null,product_metadata:meta,product_payload:p};
    if(state&&state!=='VALIDATED'){
      const pulled=/CANCEL|DELETE|DISABL|INVALID|ARCHIV|INACTIVE/.test(state);
      return{state:pulled?'pulled':'unknown',reason:`cart_state_${state.toLowerCase()}`,api_status:apiStatus,api_state:state,waiting_list:false,api_error:null,product_metadata:meta,product_payload:p};
    }
    const low=p.stock?.low_stock===true||String(p.stock?.low_stock).toLowerCase()==='true';
    return{state:low?'low_stock':'available',reason:low?'cart_low_stock':'cart_buyable',api_status:apiStatus,api_state:state||null,waiting_list:false,api_error:null,product_metadata:meta,product_payload:p};
  }
  let pageStatus=0,html='',pageError='';try{const r=await fetch(productUrl,{headers:{'user-agent':'Mozilla/5.0 (compatible; CollectishSecretLairWatch/1.1)','accept':'text/html,application/xhtml+xml'}});pageStatus=r.status;html=await r.text()}catch(e){pageError=String((e as Error).message||e)}
  const fallback=htmlClassify(html,pageStatus);
  return{...fallback,api_status:apiStatus||null,api_state:null,waiting_list:null,api_error:apiError||api?.result?.msg||null,page_status:pageStatus||null,page_error:pageError||null,page_metadata:html?pageMetadata(html):{}};
}
async function fetchTarget(t:any){
  const at=new Date().toISOString(),result=await cartState(String(t.external_product_id||''),t.product_url);
  const key=t.kind==='bundle'?`bundle_offer_id=eq.${encodeURIComponent(t.id)}`:t.kind==='randomized'?`randomized_product_offer_id=eq.${encodeURIComponent(t.id)}`:`offer_id=eq.${encodeURIComponent(t.id)}`;
  const previous=await rest(`secret_lair_observations?select=availability_state,observed_at&${key}&order=observed_at.desc&limit=1`).catch(()=>[]),prev=previous?.[0]?.availability_state||null;
  const stableChecks=prev===result.state?Number(t.watch_unchanged_checks||0)+1:0,intervalMinutes=cadence(t,result.state,stableChecks),nextCheckAt=intervalMinutes===null?null:new Date(Date.now()+intervalMinutes*60000).toISOString(),wt=watchTable(t),snapshotted=await snapshot(t,result,at);
  await rest(`${wt.table}?${wt.key}=eq.${encodeURIComponent(t.id)}`,{method:'PATCH',prefer:'return=minimal',body:{watch_last_state:result.state,watch_last_checked_at:at,watch_next_check_at:nextCheckAt,watch_unchanged_checks:stableChecks,watch_interval_minutes:intervalMinutes,watch_stopped_at:result.state==='pulled'?at:null,watch_stop_reason:result.state==='pulled'?result.reason:null,updated_at:at}});
  if(prev===result.state)return{...t,...result,changed:false,snapshotted,stable_checks:stableChecks,interval_minutes:intervalMinutes,next_check_at:nextCheckAt};
  const row:any={user_id:t.user_id,release_id:t.release_id,drop_id:t.drop_id||null,offer_id:t.kind==='drop'?t.id:null,bundle_offer_id:t.kind==='bundle'?t.id:null,randomized_product_offer_id:t.kind==='randomized'?t.id:null,region:t.region,finish:t.finish||null,observed_at:at,observation_type:t.kind==='bundle'?'bundle_status':(result.state==='sold_out'?'sold_out':prev==='sold_out'&&['available','low_stock'].includes(result.state)?'restock':'availability'),availability_state:result.state,elapsed_minutes_from_sale:elapsed(t.sale_start_at,at),source_url:t.product_url,notes:`Official Secret Lair cart validation: ${result.reason}`,metadata:{capture_source:'secret-lair-watch',target_kind:t.kind,state_source:result.api_status===200?'scalefast_cart_validation':'official_page_fallback',reason:result.reason,previous_state:prev,api_status:result.api_status||null,api_state:result.api_state||null,waiting_list:result.waiting_list,product_metadata:result.product_metadata||null,api_error:result.api_error||null,page_status:result.page_status||null,page_error:result.page_error||null}};
  await rest('secret_lair_observations',{method:'POST',prefer:'return=minimal',body:[row]});return{...t,...result,changed:true,snapshotted,stable_checks:stableChecks,interval_minutes:intervalMinutes,next_check_at:nextCheckAt};
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(!['GET','POST'].includes(req.method))return J({error:'GET or POST required'},405);
  const key=req.headers.get('x-collectish-cron-key')||'';if(!(await cronOk(key)))return J({error:'Unauthorized'},401);
  try{
    const releases=await rest(`secret_lair_releases?select=release_id,user_id,release_name,sale_start_at,lifecycle_state&lifecycle_state=in.(pre_sale,live)&order=sale_start_at.desc&limit=8`),targets:any[]=[],integrity:any[]=[];
    for(const r of releases||[]){
      if(r.lifecycle_state==='pre_sale'&&r.sale_start_at&&new Date(r.sale_start_at).getTime()<=Date.now()){
        await rest(`secret_lair_releases?release_id=eq.${encodeURIComponent(r.release_id)}`,{method:'PATCH',prefer:'return=minimal',body:{lifecycle_state:'live',updated_at:new Date().toISOString()}});r.lifecycle_state='live';
      }
      const [drops,bundles,randomized]=await Promise.all([
      rest(`secret_lair_drop_offers?select=offer_id,drop_id,region,finish,product_url,external_product_id,watch_last_state,watch_last_checked_at,watch_next_check_at,watch_unchanged_checks,watch_interval_minutes,watch_stopped_at,watch_stop_reason,secret_lair_drops!inner(drop_name)&release_id=eq.${r.release_id}&order=region.asc,finish.asc`),
      rest(`secret_lair_bundle_offers?select=bundle_offer_id,bundle_id,region,product_url,external_product_id,watch_last_state,watch_last_checked_at,watch_next_check_at,watch_unchanged_checks,watch_interval_minutes,watch_stopped_at,watch_stop_reason,secret_lair_bundles!inner(bundle_name)&release_id=eq.${r.release_id}&order=region.asc`),
      rest(`secret_lair_randomized_product_offers?select=randomized_product_offer_id,randomized_product_id,region,product_url,external_product_id,watch_last_state,watch_last_checked_at,watch_next_check_at,watch_unchanged_checks,watch_interval_minutes,watch_stopped_at,watch_stop_reason,secret_lair_randomized_products!inner(product_name)&release_id=eq.${r.release_id}&order=region.asc`)
    ]);
      const offers=[...(drops||[]).map((x:any)=>({kind:'drop',id:x.offer_id,...x})),...(bundles||[]).map((x:any)=>({kind:'bundle',id:x.bundle_offer_id,...x})),...(randomized||[]).map((x:any)=>({kind:'randomized',id:x.randomized_product_offer_id,...x}))];
      integrity.push(await assessIntegrity(r,offers));
      for(const x of drops||[])if(x.product_url&&x.external_product_id&&!x.watch_stopped_at)targets.push({kind:'drop',id:x.offer_id,drop_id:x.drop_id,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:x.finish,product_url:x.product_url,external_product_id:x.external_product_id,title:x.secret_lair_drops?.drop_name||'',sale_start_at:r.sale_start_at,...x});
      for(const x of bundles||[])if(x.product_url&&x.external_product_id&&!x.watch_stopped_at)targets.push({kind:'bundle',id:x.bundle_offer_id,bundle_id:x.bundle_id,drop_id:null,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:null,product_url:x.product_url,external_product_id:x.external_product_id,title:x.secret_lair_bundles?.bundle_name||'',sale_start_at:r.sale_start_at,...x});
      for(const x of randomized||[])if(x.product_url&&x.external_product_id&&!x.watch_stopped_at)targets.push({kind:'randomized',id:x.randomized_product_offer_id,randomized_product_id:x.randomized_product_id,drop_id:null,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:null,product_url:x.product_url,external_product_id:x.external_product_id,title:x.secret_lair_randomized_products?.product_name||'',sale_start_at:r.sale_start_at,...x});
    }
    const totalTargets=targets.length,now=Date.now(),due=targets.filter(x=>!x.watch_next_check_at||new Date(x.watch_next_check_at).getTime()<=now);
    if(!due.length)return J({ok:true,targets:totalTargets,due:0,checked:0,changed:0,integrity,next_due_at:targets.map(x=>x.watch_next_check_at).filter(Boolean).sort()[0]||null});
    due.sort((a,b)=>`${a.region}:${a.kind}:${a.title}:${a.finish||''}`.localeCompare(`${b.region}:${b.kind}:${b.title}:${b.finish||''}`));const batchSize=Math.min(24,due.length),slots=Math.ceil(due.length/batchSize),minute=Math.floor(Date.now()/60000),slot=minute%slots,start=slot*batchSize,batch=due.slice(start,start+batchSize);
    const results=await Promise.all(batch.map(fetchTarget)),changed=results.filter(x=>x.changed),releaseIds=[...new Set(changed.map(x=>x.release_id))];
    for(const release_id of releaseIds)await fetch(`${U}/functions/v1/secret-lair-confirm`,{method:'POST',headers:{'Content-Type':'application/json','x-collectish-cron-key':key},body:JSON.stringify({release_id})}).catch(()=>null);
    return J({ok:true,source:'secret_lair_cart_validation',targets:totalTargets,due:due.length,slot,slots,checked:results.length,changed:changed.length,snapshots:results.filter(x=>x.snapshotted).length,integrity,results:results.map(x=>({kind:x.kind,title:x.title,region:x.region,finish:x.finish,product_id:x.external_product_id,state:x.state,reason:x.reason,changed:x.changed,snapshotted:x.snapshotted,stable_checks:x.stable_checks,interval_minutes:x.interval_minutes,next_check_at:x.next_check_at,waiting_list:x.waiting_list,api_state:x.api_state,api_status:x.api_status,api_error:x.api_error||null}))});
  }catch(e){return J({error:String((e as Error).message||e)},502)}
});
