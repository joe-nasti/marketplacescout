import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const SCALEFAST='https://eu-api.scalefast.com';
const BUCKET='secret-lair-assets';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-collectish-cron-key, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(token=S,api=S)=>({apikey:api,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function cronOk(key:string){if(!key)return false;const x=await rest('rpc/verify_collectish_cron_key',{method:'POST',body:{p_key:key}}).catch(()=>false);return x===true}
async function authUser(token:string){if(!token)return null;const r=await fetch(`${U}/auth/v1/user`,{headers:H(token,A)});if(!r.ok)return null;const u=await r.json();return u?.id?u:null}
const slug=(s:any)=>String(s||'asset').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||'asset';
const extFor=(url:string,mime:string)=>{const m=String(mime||'').toLowerCase();if(m.includes('webp'))return'webp';if(m.includes('gif'))return'gif';if(m.includes('jpeg')||m.includes('jpg'))return'jpg';if(m.includes('png'))return'png';const x=(new URL(url)).pathname.split('.').pop()?.toLowerCase();return ['png','jpg','jpeg','webp','gif'].includes(String(x))?String(x).replace('jpeg','jpg'):'png'};
async function sha256(bytes:ArrayBuffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')}
function publicUrl(path:string){return `${U}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`}
async function upload(path:string,bytes:ArrayBuffer,mime:string){const r=await fetch(`${U}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{apikey:S,Authorization:`Bearer ${S}`,'Content-Type':mime||'application/octet-stream','x-upsert':'true','Cache-Control':'31536000'},body:bytes});if(!r.ok)throw Error(`Storage ${r.status}: ${(await r.text()).slice(0,240)}`)}

async function productAssets(productId:string){const r=await fetch(`${SCALEFAST}/product/${encodeURIComponent(productId)}?fields=productID,image,image_min,secondary_image,images,other_images`,{headers:{accept:'application/json','user-agent':'CollectishSecretLairAssets/1.0'}});const d=await r.json().catch(()=>null);if(!r.ok||d?.result?.status!=='OK'||!d?.response_data?.productID)throw Error(d?.result?.msg||`Scalefast product ${r.status}`);return d.response_data}
function candidates(p:any){const out:any[]=[];if(p?.image)out.push({type:'thumbnail',url:p.image,primary:true,sort:0});if(p?.secondary_image&&p.secondary_image!==p.image)out.push({type:'contents',url:p.secondary_image,primary:true,sort:0});const extras=Array.isArray(p?.other_images)?p.other_images:[];let i=0;for(const x of extras){const u=x?.desktop||x?.mobile||x?.url;if(!u||out.some(y=>y.url===u))continue;out.push({type:'gallery',url:u,primary:false,sort:10+i++})}return out}
function pickOffer(offers:any[]){const score=(o:any)=>{let n=0;if(o.region==='US')n+=100;else if(o.region==='REU')n+=50;else n+=10;if(o.finish==='nonfoil')n+=20;else if(o.finish==='foil')n+=10;return n};return [...offers].filter(o=>o.external_product_id).sort((a,b)=>score(b)-score(a))[0]||null}

async function syncDrop(drop:any,force=false){
  const offers=await rest(`secret_lair_drop_offers?select=offer_id,region,finish,external_product_id,product_url&drop_id=eq.${encodeURIComponent(drop.drop_id)}&external_product_id=not.is.null`);
  const source=pickOffer(offers||[]);if(!source)return{drop_id:drop.drop_id,drop_name:drop.drop_name,downloaded:0,skipped:0,error:'no_official_product'};
  const product=await productAssets(String(source.external_product_id));const list=candidates(product);let downloaded=0,skipped=0,errors=0;
  for(const [index,a] of list.entries()){
    try{
      const existing=await rest(`secret_lair_assets?select=asset_id,content_hash,download_status,source_url,storage_path&drop_id=eq.${drop.drop_id}&asset_type=eq.${a.type}&sort_order=eq.${a.sort}&limit=1`).catch(()=>[]);
      if(!force&&existing?.[0]?.download_status==='downloaded'&&existing[0].source_url===a.url){skipped++;continue}
      const image=await fetch(a.url,{headers:{'user-agent':'CollectishSecretLairAssets/1.0','accept':'image/*'}});if(!image.ok)throw Error(`image_http_${image.status}`);
      const mime=(image.headers.get('content-type')||'image/png').split(';')[0],bytes=await image.arrayBuffer();if(bytes.byteLength<=0||bytes.byteLength>15*1024*1024)throw Error(`image_size_${bytes.byteLength}`);
      const hash=await sha256(bytes),ext=extFor(a.url,mime),path=`${drop.release_id}/${drop.drop_id}/${a.type}-${String(a.sort).padStart(2,'0')}-${hash.slice(0,12)}.${ext}`;
      await upload(path,bytes,mime);
      await rest('secret_lair_assets?on_conflict=storage_bucket,storage_path',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:[{user_id:drop.user_id,release_id:drop.release_id,drop_id:drop.drop_id,bundle_id:null,asset_type:a.type,source_url:a.url,source_product_id:String(source.external_product_id),source_region:source.region,storage_bucket:BUCKET,storage_path:path,public_url:publicUrl(path),mime_type:mime,content_hash:hash,sort_order:a.sort,is_primary:Boolean(a.primary),download_status:'downloaded',last_fetched_at:new Date().toISOString(),metadata:{source:'scalefast_product_api',source_finish:source.finish,source_offer_id:source.offer_id,byte_length:bytes.byteLength,source_index:index}}]});
      if(existing?.[0]?.asset_id&&existing[0].storage_path!==path)await rest(`secret_lair_assets?asset_id=eq.${existing[0].asset_id}`,{method:'PATCH',body:{is_primary:false,download_status:'stale',updated_at:new Date().toISOString()}}).catch(()=>null);
      downloaded++;
    }catch(e){errors++;await rest('secret_lair_assets',{method:'POST',prefer:'return=minimal',body:[{user_id:drop.user_id,release_id:drop.release_id,drop_id:drop.drop_id,asset_type:a.type,source_url:a.url,source_product_id:String(source.external_product_id),source_region:source.region,storage_path:`errors/${drop.drop_id}/${a.type}-${a.sort}-${Date.now()}`,sort_order:a.sort,is_primary:Boolean(a.primary),download_status:'error',last_fetched_at:new Date().toISOString(),metadata:{source:'scalefast_product_api',error:String((e as Error).message||e)}}]}).catch(()=>null)}
  }
  return{drop_id:drop.drop_id,drop_name:drop.drop_name,source_product_id:String(source.external_product_id),source_region:source.region,source_finish:source.finish,candidates:list.length,downloaded,skipped,errors};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(!['GET','POST'].includes(req.method))return J({error:'GET or POST required'},405);
  const cronKey=req.headers.get('x-collectish-cron-key')||'',cron=await cronOk(cronKey),token=bearer(req),user=cron?null:await authUser(token);if(!cron&&!user)return J({error:'Authentication required'},401);
  let b:any={};if(req.method==='POST')try{b=await req.json()}catch{}
  try{
    const releaseId=String(b?.release_id||''),dropId=String(b?.drop_id||''),force=Boolean(b?.force);
    let path='secret_lair_drops?select=drop_id,release_id,user_id,drop_name&order=created_at.desc&limit=50';
    if(dropId)path=`secret_lair_drops?select=drop_id,release_id,user_id,drop_name&drop_id=eq.${encodeURIComponent(dropId)}&limit=1`;
    else if(releaseId)path=`secret_lair_drops?select=drop_id,release_id,user_id,drop_name&release_id=eq.${encodeURIComponent(releaseId)}&order=created_at.asc&limit=50`;
    else if(cron)path='secret_lair_drops?select=drop_id,release_id,user_id,drop_name,secret_lair_releases!inner(lifecycle_state)&secret_lair_releases.lifecycle_state=in.(announced,pre_sale,live,shipping)&order=created_at.desc&limit=40';
    let drops=await rest(path);if(!cron&&user)drops=(drops||[]).filter((d:any)=>d.user_id===user.id);
    if(cron&&!dropId&&!releaseId){const assets=await rest('secret_lair_assets?select=drop_id,download_status&asset_type=eq.thumbnail&is_primary=eq.true&download_status=eq.downloaded&limit=500').catch(()=>[]),done=new Set((assets||[]).map((a:any)=>a.drop_id));const pending=(drops||[]).filter((d:any)=>!done.has(d.drop_id));drops=(pending.length?pending:drops||[]).slice(0,2)}
    const results=[];for(const d of drops||[])results.push(await syncDrop(d,force));
    return J({ok:true,cron_mode:cron,drops:results.length,results});
  }catch(e){return J({error:String((e as Error).message||e)},502)}
});
