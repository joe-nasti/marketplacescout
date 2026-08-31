import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const CRON=Deno.env.get('TCGPLAYER_PRICE_CRON_KEY')||Deno.env.get('COLLECTISH_CRON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-collectish-cron-key, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
const norm=(s:any)=>String(s||'').replace(/\s+/g,' ').trim();
function classify(html:string,title:string,status:number){
  if(status>=400)return{state:'unknown',reason:`http_${status}`};
  const lower=html.toLowerCase(),needle=title.toLowerCase();let i=needle?lower.indexOf(needle):-1;
  const scope=(i>=0?lower.slice(i,Math.min(lower.length,i+18000)):lower.slice(0,18000));
  if(/sale cancelled|sale canceled/.test(scope))return{state:'pulled',reason:'sale_cancelled'};
  if(/no longer available|waiting list/.test(scope))return{state:'sold_out',reason:'no_longer_available'};
  if(/low stock/.test(scope))return{state:'low_stock',reason:'low_stock'};
  if(/temporarily unavailable/.test(scope))return{state:'unknown',reason:'temporarily_unavailable'};
  if(/add to cart|preorder now|pre-order now/.test(scope))return{state:'available',reason:'add_to_cart'};
  if(/coming soon/.test(scope))return{state:'unknown',reason:'coming_soon'};
  return{state:'unknown',reason:'no_state_marker'};
}
function elapsed(start:string|null,at:string){if(!start)return null;const n=Math.round((new Date(at).getTime()-new Date(start).getTime())/60000);return Number.isFinite(n)?n:null}
async function fetchTarget(t:any){
  const at=new Date().toISOString();let status=0,html='',error='';
  try{const r=await fetch(t.product_url,{headers:{'user-agent':'Mozilla/5.0 (compatible; CollectishSecretLairWatch/1.0)','accept':'text/html,application/xhtml+xml'}});status=r.status;html=await r.text()}catch(e){error=String((e as Error).message||e)}
  const result=error?{state:'unknown',reason:'fetch_error'}:classify(html,t.title,status);
  const key=t.kind==='bundle'?`bundle_offer_id=eq.${encodeURIComponent(t.id)}`:`offer_id=eq.${encodeURIComponent(t.id)}`;
  const previous=await rest(`secret_lair_observations?select=availability_state,observed_at&${key}&order=observed_at.desc&limit=1`).catch(()=>[]);
  const prev=previous?.[0]?.availability_state||null;
  if(prev===result.state)return{...t,state:result.state,reason:result.reason,changed:false,http_status:status,error};
  const row:any={user_id:t.user_id,release_id:t.release_id,drop_id:t.drop_id||null,offer_id:t.kind==='drop'?t.id:null,bundle_offer_id:t.kind==='bundle'?t.id:null,region:t.region,finish:t.finish||null,observed_at:at,observation_type:t.kind==='bundle'?'bundle_status':(result.state==='sold_out'?'sold_out':prev==='sold_out'&&result.state==='available'?'restock':'availability'),availability_state:result.state,elapsed_minutes_from_sale:elapsed(t.sale_start_at,at),source_url:t.product_url,notes:`Official Secret Lair storefront: ${result.reason}`,metadata:{capture_source:'secret-lair-watch',http_status:status,reason:result.reason,previous_state:prev,fetch_error:error||null}};
  await rest('secret_lair_observations',{method:'POST',prefer:'return=minimal',body:[row]});
  return{...t,state:result.state,reason:result.reason,changed:true,http_status:status,error};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(!['GET','POST'].includes(req.method))return J({error:'GET or POST required'},405);
  const key=req.headers.get('x-collectish-cron-key')||'';if(!CRON||key!==CRON)return J({error:'Unauthorized'},401);
  try{
    const releases=await rest(`secret_lair_releases?select=release_id,user_id,release_name,sale_start_at,lifecycle_state&lifecycle_state=in.(pre_sale,live)&order=sale_start_at.desc&limit=8`);
    const targets:any[]=[];
    for(const r of releases||[]){
      const [drops,bundles]=await Promise.all([
        rest(`secret_lair_drop_offers?select=offer_id,drop_id,region,finish,product_url,secret_lair_drops!inner(drop_name)&release_id=eq.${r.release_id}&product_url=not.is.null&order=region.asc,finish.asc`),
        rest(`secret_lair_bundle_offers?select=bundle_offer_id,bundle_id,region,product_url,secret_lair_bundles!inner(bundle_name)&release_id=eq.${r.release_id}&product_url=not.is.null&order=region.asc`)
      ]);
      for(const x of drops||[])targets.push({kind:'drop',id:x.offer_id,drop_id:x.drop_id,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:x.finish,product_url:x.product_url,title:x.secret_lair_drops?.drop_name||'',sale_start_at:r.sale_start_at});
      for(const x of bundles||[])targets.push({kind:'bundle',id:x.bundle_offer_id,bundle_id:x.bundle_id,drop_id:null,release_id:r.release_id,user_id:r.user_id,region:x.region,finish:null,product_url:x.product_url,title:x.secret_lair_bundles?.bundle_name||'',sale_start_at:r.sale_start_at});
    }
    if(!targets.length)return J({ok:true,targets:0,checked:0,changed:0});
    targets.sort((a,b)=>`${a.region}:${a.kind}:${a.title}:${a.finish||''}`.localeCompare(`${b.region}:${b.kind}:${b.title}:${b.finish||''}`));
    const batchSize=Math.min(24,targets.length),slots=Math.ceil(targets.length/batchSize),minute=Math.floor(Date.now()/60000),slot=minute%slots,start=slot*batchSize,batch=targets.slice(start,start+batchSize);
    const results=await Promise.all(batch.map(fetchTarget));const changed=results.filter(x=>x.changed);
    const releaseIds=[...new Set(changed.map(x=>x.release_id))];
    for(const release_id of releaseIds){await fetch(`${U}/functions/v1/secret-lair-confirm`,{method:'POST',headers:{'Content-Type':'application/json','x-collectish-cron-key':key},body:JSON.stringify({release_id})}).catch(()=>null)}
    return J({ok:true,targets:targets.length,slot,slots,checked:results.length,changed:changed.length,results:results.map(x=>({kind:x.kind,title:x.title,region:x.region,finish:x.finish,state:x.state,reason:x.reason,changed:x.changed,http_status:x.http_status,error:x.error||null}))});
  }catch(e){return J({error:String((e as Error).message||e)},502)}
});
