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
  if(state==='pulled'){base=cap=1440}
  else if(state==='unknown'){base=15;cap=360}
  else if(state==='sold_out'){
    if(age!==null&&age<360){base=15;cap=60}
    else if(age!==null&&age<4320){base=30;cap=180}
    else if(age!==null&&age<20160){base=60;cap=720}
    else{base=180;cap=1440}
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
async function cartState(productId:string,productUrl:string){
  let apiStatus=0,api:any=null,apiError='';
  try{const fields='productID,waiting_list,state,stock,limit_purchase,creation_date,release_date,price_info,specific,extension,custom_fields';const r=await fetch(`${SCALEFAST}/product/${encodeURIComponent(productId)}?fields=${fields}`,{headers:{accept:'application/json','user-agent':'CollectishSecretLairWatch/1.2'}});apiStatus=r.status;api=await r.json()}catch(e){apiError=String((e as Error).message||e)}
  const ok=apiStatus===200&&api?.result?.status==='OK'&&api?.response_data?.productID;
  if(ok){
    const state=String(api.response_data.state||'').toUpperCase(),waiting=api.response_data.waiting_list===true||String(api.response_data.waiting_list).toLowerCase()==='true';
    const p=api.response_data,meta={stock:p.stock??null,limit_purchase:p.limit_purchase??null,creation_date:p.creation_date??null,release_date:p.release_date??null,price_info:p.price_info??null,provider_id:p.specific?.extension?.custom?.id_to_use_with_provider??null,refid:p.extension?.refid??null,custom_fields:p.custom_fields??null};
    if(waiting)return{state:'sold_out',reason:'cart_waiting_list',api_status:apiStatus,api_state:state,waiting_list:true,api_error:null,product_metadata:meta};
    if(state&&state!=='VALIDATED'){
      const pulled=/CANCEL|DELETE|DISABL|INVALID|ARCHIV|INACTIVE/.test(state);
      return{state:pulled?'pulled':'unknown',reason:`cart_state_${state.toLowerCase()}`,api_status:apiStatus,api_state:state,waiting_list:false,api_error:null,product_metadata:meta};
    }
    const low=p.stock?.low_stock===true||String(p.stock?.low_stock).toLowerCase()==='true';
    return{state:low?'low_stock':'available',reason:low?'cart_low_stock':'cart_buyable',api_status:apiStatus,api_state:state||null,waiting_list:false,api_error:null,product_metadata:meta};
  }
  let pageStatus=0,html='',pageError='';try{const r=await fetch(productUrl,{headers:{'user-agent':'Mozilla/5.0 (compatible; CollectishSecretLairWatch/1.1)','accept':'text/html,application/xhtml+xml'}});pageStatus=r.status;html=await r.text()}catch(e){pageError=String((e as Error).message||e)}
  const fallback=htmlClassify(html,pageStatus);
  return{...fallback,api_status:apiStatus||null,api_state:null,waiting_list:null,api_error:apiError||api?.result?.msg||null,page_status:pageStatus||null,page_error:pageError||null};
}
async function fetchTarget(t:any){
  const at=new Date().toISOString(),result=await cartState(String(t.external_product_id||''),t.product_url);
  const key=t.kind==='bundle'?`bundle_offer_id=eq.${encodeURIComponent(t.id)}`:t.kind==='randomized'?`randomized_product_offer_id=eq.${encodeURIComponent(t.id)}`:`offer_id=eq.${encodeURIComponent(t.id)}`;
  const previous=await rest(`secret_lair_observations?select=availability_state,observed_at&${key}&order=observed_at.desc&limit=1`).catch(()=>[]),prev=previous?.[0]?.availability_state||null;
  const stableChecks=prev===result.state?Number(t.watch_unchanged_checks||0)+1:0,intervalMinutes=cadence(t,result.state,stableChecks),nextCheckAt=new Date(Date.now()+intervalMinutes*60000).toISOString(),wt=watchTable(t);
  await rest(`${wt.table}?${wt.key}=eq.${encodeURIComponent(t.id)}`,{method:'PATCH',prefer:'return=minimal',body:{watch_last_state:result.state,watch_last_checked_at:at,watch_next_check_at:nextCheckAt,watch_unchanged_checks:stableChecks,watch_interval_minutes:intervalMinutes,updated_at:at}});
  if(prev===result.state)return{...t,...result,changed:false,stable_checks:stableChecks,interval_minutes:intervalMinutes,next_check_at:nextCheckAt};
  const row:any={user_id:t.user_id,release_id:t.release_id,drop_id:t.drop_id||null,offer_id:t.kind==='drop'?t.id:null,bundle_offer_id:t.kind==='bundle'?t.id:null,randomized_product_offer_id:t.kind==='randomized'?t.id:null,region:t.region,finish:t.finish||null,observed_at:at,observation_type:t.kind==='bundle'?'bundle_status':(result.state==='sold_out'?'sold_out':prev==='sold_out'&&['available','low_stock'].includes(result.state)?'restock':'availability'),availability_state:result.state,elapsed_minutes_from_sale:elapsed(t.sale_start_at,at),source_url:t.product_url,notes:`Official Secret Lair cart validation: ${result.reason}`,metadata:{capture_source:'secret-lair-watch',target_kind:t.kind,state_source:result.api_status===200?'scalefast_cart_validation':'official_page_fallback',reason:result.reason,previous_state:prev,api_status:result.api_status||null,api_state:result.api_state||null,waiting_list:result.waiting_list,product_metadata:result.product_metadata||null,api_error:result.api_error||null,page_status:result.page_status||null,page_error:result.page_error||null}};
  await rest('secret_lair_observations',{method:'POST',prefer:'return=minimal',body:[row]});return{...t,...result,changed:true,stable_checks:stableChecks,interval_minutes:intervalMinutes,next_check_at:nextCheckAt};
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(!['GET','POST'].includes(req.method))return J({error:'GET or POST required'},405);
  const key=req.headers.get('x-collectish-cron-key')||'';if(!(await cronOk(key)))return J({error:'Unauthorized'},401);
  try{
    const releases=await rest(`secret_lair_releases?select=release_id,user_id,release_name,sale_start_at,lifecycle_state&lifecycle_state=in.(pre_sale,live)&order=sale_start_at.desc&limit=8`),targets:any[]=[];
    for(const r of releases||[]){
      if(r.lifecycle_state==='pre_sale'&&r.sale_start_at&&new Date(r.sale_start_at).getTime()<=Date.now()){
        await rest(`secret_lair_releases?release_id=eq.${encodeURIComponent(r.release_id)}`,{method:'PATCH',prefer:'return=minimal',body:{lifecycle_state:'live',updated_at:new Date().toISOString()}});r.lifecycle_state='live';
      }
      const [drops,bundles,randomized]=await Promise.all([
      rest(`secret_lair_drop_offers?select=offer_id,drop_id,region,finish,product_url,external_product_id,watch_last_state,watch_last_checked_at,watch_next_check_at,watch_unchanged_checks,watch_interval_minutes,secret_lair_drops!inner(drop_name)&release_id=eq.${r.release_id}&product_url=not.is.null&external_product_id=not.is.null&order=region.asc,finish.asc`),
      rest(`secret_lair_bundle_offers?select=bundle_offer_id,bundle_id,region,product_url,external_product_id,watch_last_state,watch_last_checked_at,watch_next_check_at,watch_unchanged_checks,watch_interval_minutes,secret_lair_bundles!inner(bundle_name)&release_id=eq.${r.release_id}&product_url=not.is.null&external_product_id=not.is.null&order=region.asc`),
      rest(`secret_lair_randomized_product_offers?select=randomized_product_offer_id,randomized_product_id,region,product_url,external_product_id,watch_last_state,watch_last_checked_at,watch_next_check_at,watch_unchanged_checks,watch_interval_minutes,secret_lair_randomized_products!inner(product_name)&release_id=eq.${r.release_id}&product_url=not.is.null&external_product_id=not.is.null&order=region.asc`)
    ]);
      for(const x of drops||[])targets.push({kind:'drop',id:x.offer_id,drop_id:x.drop_id,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:x.finish,product_url:x.product_url,external_product_id:x.external_product_id,title:x.secret_lair_drops?.drop_name||'',sale_start_at:r.sale_start_at,...x});
      for(const x of bundles||[])targets.push({kind:'bundle',id:x.bundle_offer_id,bundle_id:x.bundle_id,drop_id:null,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:null,product_url:x.product_url,external_product_id:x.external_product_id,title:x.secret_lair_bundles?.bundle_name||'',sale_start_at:r.sale_start_at,...x});
      for(const x of randomized||[])targets.push({kind:'randomized',id:x.randomized_product_offer_id,randomized_product_id:x.randomized_product_id,drop_id:null,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:null,product_url:x.product_url,external_product_id:x.external_product_id,title:x.secret_lair_randomized_products?.product_name||'',sale_start_at:r.sale_start_at,...x});
    }
    const totalTargets=targets.length,now=Date.now(),due=targets.filter(x=>!x.watch_next_check_at||new Date(x.watch_next_check_at).getTime()<=now);
    if(!due.length)return J({ok:true,targets:totalTargets,due:0,checked:0,changed:0,next_due_at:targets.map(x=>x.watch_next_check_at).filter(Boolean).sort()[0]||null});
    due.sort((a,b)=>`${a.region}:${a.kind}:${a.title}:${a.finish||''}`.localeCompare(`${b.region}:${b.kind}:${b.title}:${b.finish||''}`));const batchSize=Math.min(24,due.length),slots=Math.ceil(due.length/batchSize),minute=Math.floor(Date.now()/60000),slot=minute%slots,start=slot*batchSize,batch=due.slice(start,start+batchSize);
    const results=await Promise.all(batch.map(fetchTarget)),changed=results.filter(x=>x.changed),releaseIds=[...new Set(changed.map(x=>x.release_id))];
    for(const release_id of releaseIds)await fetch(`${U}/functions/v1/secret-lair-confirm`,{method:'POST',headers:{'Content-Type':'application/json','x-collectish-cron-key':key},body:JSON.stringify({release_id})}).catch(()=>null);
    return J({ok:true,source:'secret_lair_cart_validation',targets:totalTargets,due:due.length,slot,slots,checked:results.length,changed:changed.length,results:results.map(x=>({kind:x.kind,title:x.title,region:x.region,finish:x.finish,product_id:x.external_product_id,state:x.state,reason:x.reason,changed:x.changed,stable_checks:x.stable_checks,interval_minutes:x.interval_minutes,next_check_at:x.next_check_at,waiting_list:x.waiting_list,api_state:x.api_state,api_status:x.api_status,api_error:x.api_error||null}))});
  }catch(e){return J({error:String((e as Error).message||e)},502)}
});
