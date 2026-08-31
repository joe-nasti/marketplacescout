import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const SCALEFAST='https://eu-api.scalefast.com';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-collectish-cron-key, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function cronOk(key:string){if(!key)return false;const x=await rest('rpc/verify_collectish_cron_key',{method:'POST',body:{p_key:key}}).catch(()=>false);return x===true}
function htmlClassify(html:string,status:number){if(status>=400)return{state:'unknown',reason:`page_http_${status}`};const lower=html.toLowerCase();if(/sale cancelled|sale canceled/.test(lower))return{state:'pulled',reason:'page_sale_cancelled'};if(/no longer available|waiting list/.test(lower))return{state:'sold_out',reason:'page_no_longer_available'};if(/low stock/.test(lower))return{state:'low_stock',reason:'page_low_stock'};if(/add to cart|preorder now|pre-order now/.test(lower))return{state:'available',reason:'page_add_to_cart'};return{state:'unknown',reason:'page_no_state_marker'}}
function elapsed(start:string|null,at:string){if(!start)return null;const n=Math.round((new Date(at).getTime()-new Date(start).getTime())/60000);return Number.isFinite(n)?n:null}
async function cartState(productId:string,productUrl:string){
  let apiStatus=0,api:any=null,apiError='';
  try{const r=await fetch(`${SCALEFAST}/product/${encodeURIComponent(productId)}?fields=productID,waiting_list,state`,{headers:{accept:'application/json','user-agent':'CollectishSecretLairWatch/1.1'}});apiStatus=r.status;api=await r.json()}catch(e){apiError=String((e as Error).message||e)}
  const ok=apiStatus===200&&api?.result?.status==='OK'&&api?.response_data?.productID;
  if(ok){
    const state=String(api.response_data.state||'').toUpperCase(),waiting=api.response_data.waiting_list===true||String(api.response_data.waiting_list).toLowerCase()==='true';
    if(waiting)return{state:'sold_out',reason:'cart_waiting_list',api_status:apiStatus,api_state:state,waiting_list:true,api_error:null};
    if(state&&state!=='VALIDATED'){
      const pulled=/CANCEL|DELETE|DISABL|INVALID|ARCHIV|INACTIVE/.test(state);
      return{state:pulled?'pulled':'unknown',reason:`cart_state_${state.toLowerCase()}`,api_status:apiStatus,api_state:state,waiting_list:false,api_error:null};
    }
    return{state:'available',reason:'cart_buyable',api_status:apiStatus,api_state:state||null,waiting_list:false,api_error:null};
  }
  let pageStatus=0,html='',pageError='';try{const r=await fetch(productUrl,{headers:{'user-agent':'Mozilla/5.0 (compatible; CollectishSecretLairWatch/1.1)','accept':'text/html,application/xhtml+xml'}});pageStatus=r.status;html=await r.text()}catch(e){pageError=String((e as Error).message||e)}
  const fallback=htmlClassify(html,pageStatus);
  return{...fallback,api_status:apiStatus||null,api_state:null,waiting_list:null,api_error:apiError||api?.result?.msg||null,page_status:pageStatus||null,page_error:pageError||null};
}
async function fetchTarget(t:any){
  const at=new Date().toISOString(),result=await cartState(String(t.external_product_id||''),t.product_url);
  const key=t.kind==='bundle'?`bundle_offer_id=eq.${encodeURIComponent(t.id)}`:`offer_id=eq.${encodeURIComponent(t.id)}`;
  const previous=await rest(`secret_lair_observations?select=availability_state,observed_at&${key}&order=observed_at.desc&limit=1`).catch(()=>[]),prev=previous?.[0]?.availability_state||null;
  if(prev===result.state)return{...t,...result,changed:false};
  const row:any={user_id:t.user_id,release_id:t.release_id,drop_id:t.drop_id||null,offer_id:t.kind==='drop'?t.id:null,bundle_offer_id:t.kind==='bundle'?t.id:null,region:t.region,finish:t.finish||null,observed_at:at,observation_type:t.kind==='bundle'?'bundle_status':(result.state==='sold_out'?'sold_out':prev==='sold_out'&&result.state==='available'?'restock':'availability'),availability_state:result.state,elapsed_minutes_from_sale:elapsed(t.sale_start_at,at),source_url:t.product_url,notes:`Official Secret Lair cart validation: ${result.reason}`,metadata:{capture_source:'secret-lair-watch',state_source:result.api_status===200?'scalefast_cart_validation':'official_page_fallback',reason:result.reason,previous_state:prev,api_status:result.api_status||null,api_state:result.api_state||null,waiting_list:result.waiting_list,api_error:result.api_error||null,page_status:result.page_status||null,page_error:result.page_error||null}};
  await rest('secret_lair_observations',{method:'POST',prefer:'return=minimal',body:[row]});return{...t,...result,changed:true};
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(!['GET','POST'].includes(req.method))return J({error:'GET or POST required'},405);
  const key=req.headers.get('x-collectish-cron-key')||'';if(!(await cronOk(key)))return J({error:'Unauthorized'},401);
  try{
    const releases=await rest(`secret_lair_releases?select=release_id,user_id,release_name,sale_start_at,lifecycle_state&lifecycle_state=in.(pre_sale,live)&order=sale_start_at.desc&limit=8`),targets:any[]=[];
    for(const r of releases||[]){const [drops,bundles]=await Promise.all([
      rest(`secret_lair_drop_offers?select=offer_id,drop_id,region,finish,product_url,external_product_id,secret_lair_drops!inner(drop_name)&release_id=eq.${r.release_id}&product_url=not.is.null&external_product_id=not.is.null&order=region.asc,finish.asc`),
      rest(`secret_lair_bundle_offers?select=bundle_offer_id,bundle_id,region,product_url,external_product_id,secret_lair_bundles!inner(bundle_name)&release_id=eq.${r.release_id}&product_url=not.is.null&external_product_id=not.is.null&order=region.asc`)
    ]);
      for(const x of drops||[])targets.push({kind:'drop',id:x.offer_id,drop_id:x.drop_id,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:x.finish,product_url:x.product_url,external_product_id:x.external_product_id,title:x.secret_lair_drops?.drop_name||'',sale_start_at:r.sale_start_at});
      for(const x of bundles||[])targets.push({kind:'bundle',id:x.bundle_offer_id,bundle_id:x.bundle_id,drop_id:null,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:null,product_url:x.product_url,external_product_id:x.external_product_id,title:x.secret_lair_bundles?.bundle_name||'',sale_start_at:r.sale_start_at});
    }
    if(!targets.length)return J({ok:true,targets:0,checked:0,changed:0});
    targets.sort((a,b)=>`${a.region}:${a.kind}:${a.title}:${a.finish||''}`.localeCompare(`${b.region}:${b.kind}:${b.title}:${b.finish||''}`));const batchSize=Math.min(24,targets.length),slots=Math.ceil(targets.length/batchSize),minute=Math.floor(Date.now()/60000),slot=minute%slots,start=slot*batchSize,batch=targets.slice(start,start+batchSize);
    const results=await Promise.all(batch.map(fetchTarget)),changed=results.filter(x=>x.changed),releaseIds=[...new Set(changed.map(x=>x.release_id))];
    for(const release_id of releaseIds)await fetch(`${U}/functions/v1/secret-lair-confirm`,{method:'POST',headers:{'Content-Type':'application/json','x-collectish-cron-key':key},body:JSON.stringify({release_id})}).catch(()=>null);
    return J({ok:true,source:'secret_lair_cart_validation',targets:targets.length,slot,slots,checked:results.length,changed:changed.length,results:results.map(x=>({kind:x.kind,title:x.title,region:x.region,finish:x.finish,product_id:x.external_product_id,state:x.state,reason:x.reason,changed:x.changed,waiting_list:x.waiting_list,api_state:x.api_state,api_status:x.api_status,api_error:x.api_error||null}))});
  }catch(e){return J({error:String((e as Error).message||e)},502)}
});
