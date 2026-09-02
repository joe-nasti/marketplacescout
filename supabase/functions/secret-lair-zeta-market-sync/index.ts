import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const API='https://api.tcgplayer.com';
const H={apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'};
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-collectish-cron-key','Access-Control-Allow-Methods':'POST,OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});

async function rest(path:string,opt:any={}){
  const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H,...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});
  const t=await r.text();let d:any;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d;
}
async function rpc(name:string,body:any={}){return rest(`rpc/${name}`,{method:'POST',body})}
async function cronOk(k:string){return !!k&&(await rpc('verify_collectish_cron_key',{p_key:k}).catch(()=>false))===true}

let tokenCache:string|null=null,tokenUntil=0;
async function token(){
  if(tokenCache&&Date.now()<tokenUntil)return tokenCache;
  const a=Deno.env.get('TCGPLAYER_PUBLIC_KEY'),b=Deno.env.get('TCGPLAYER_PRIVATE_KEY');
  if(!a||!b)throw Error('missing_tcgplayer_secrets');
  const r=await fetch(`${API}/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:a,client_secret:b})});
  if(!r.ok)throw Error(`tcg_token_${r.status}`);
  const j=await r.json();tokenCache=j.access_token;tokenUntil=Date.now()+Math.max(60000,(Number(j.expires_in||3600)-60)*1000);return tokenCache!;
}
async function api(path:string,t:string){
  const r=await fetch(`${API}${path}`,{headers:{Authorization:`bearer ${t}`,Accept:'application/json'}});
  const raw=await r.text();let j:any;try{j=raw?JSON.parse(raw):null}catch{j=raw}
  if(!r.ok)throw Error(`tcg_${r.status}_${path}`);return j;
}
const norm=(s:any)=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
function extValue(p:any,names:string[]){
  const wanted=new Set(names.map(norm));
  for(const x of p?.extendedData||[]){if(wanted.has(norm(x?.name)))return String(x?.value??'').trim()}
  return '';
}
function collectorNumber(p:any){return extValue(p,['Number','Collector Number','Card Number']).replace(/^#/,'').trim()}
function productName(p:any){return String(p?.name||p?.cleanName||'').trim()}
function skuIds(p:any){return (p?.skus||p?.sku||[]).map((x:any)=>String(x?.skuId??x?.id??'')).filter((x:string)=>/^\d+$/.test(x))}

async function findZetaGroup(t:string){
  // Magic category = 1. Newest groups first means this should normally be one request.
  let offset=0;
  for(let page=0;page<4;page++){
    const j=await api(`/catalog/categories/1/groups?offset=${offset}&limit=100&sortOrder=PublishedOn&sortDesc=true`,t),rows=j?.results||[];
    const hit=rows.find((g:any)=>norm(g?.abbreviation)==='slz'||norm(g?.name).includes('zeta set')||norm(g?.name).includes('secret lair x mschf'));
    if(hit)return hit;
    if(rows.length<100||offset+rows.length>=Number(j?.totalItems||0))break;
    offset+=rows.length;
  }
  return null;
}
async function allProductsForGroup(groupId:number,t:string){
  const out:any[]=[];let offset=0;
  for(let page=0;page<10;page++){
    const j=await api(`/catalog/products?groupId=${groupId}&includeSkus=true&getExtendedFields=true&offset=${offset}&limit=250`,t),rows=j?.results||[];
    out.push(...rows);
    if(!rows.length||rows.length<250||out.length>=Number(j?.totalItems||0))break;
    offset+=rows.length;
  }
  return out;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  if(!(await cronOk(req.headers.get('x-collectish-cron-key')||'')))return J({error:'Unauthorized'},401);
  try{
    const context=await rest('secret_lair_randomized_tcg_discovery_context?select=user_id,randomized_product_id,randomized_card_printing_id,card_name,rarity,collector_number,treatment_canonical_name&limit=500');
    const existing=await rest('secret_lair_randomized_tcgplayer_printings?select=randomized_card_printing_id,discovery_status&discovery_status=eq.confirmed&limit=500').catch(()=>[]);
    if((context||[]).length>0&&(existing||[]).length>=(context||[]).length){
      return J({ok:true,status:'mapping_complete',source:'local_mapping_state',confirmed:(existing||[]).length,context_count:(context||[]).length,tcgplayer_calls:0});
    }

    const t=await token();
    const group=await findZetaGroup(t);
    if(!group)return J({ok:true,status:'set_not_published',source:'tcgplayer_official_catalog',checked:'magic_groups'});

    const products=await allProductsForGroup(Number(group.groupId),t);
    const byKey=new Map<string,any>();
    for(const p of products){const cn=collectorNumber(p);if(cn)byKey.set(`${norm(productName(p))}|${norm(cn)}`,p)}

    const now=new Date().toISOString(),saveRows:any[]=[];let matched=0,unmatched=0,skuCount=0;
    for(const c of context||[]){
      const p=byKey.get(`${norm(c.card_name)}|${norm(c.collector_number)}`);
      if(!p){unmatched++;continue}
      const skus=skuIds(p);skuCount+=skus.length;matched++;
      saveRows.push({user_id:c.user_id,randomized_product_id:c.randomized_product_id,randomized_card_printing_id:c.randomized_card_printing_id,tcgplayer_product_id:String(p.productId),tcgplayer_sku_ids:skus,product_name:productName(p),set_name:group.name||'The Zeta Set',discovery_query:null,discovery_confidence:1,discovery_status:'confirmed',discovery_source:'tcgplayer_official_group_products',first_seen_at:now,last_seen_at:now,last_attempt_at:now,details:{group_id:group.groupId,group_name:group.name,group_abbreviation:group.abbreviation,collector_number:collectorNumber(p),modified_on:p.modifiedOn||null},updated_at:now});
    }
    if(saveRows.length)await rest('secret_lair_randomized_tcgplayer_printings?on_conflict=user_id,randomized_card_printing_id',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:saveRows});

    return J({ok:true,status:'set_published',source:'tcgplayer_official_catalog',group:{group_id:group.groupId,name:group.name,abbreviation:group.abbreviation,published_on:group.publishedOn,modified_on:group.modifiedOn},product_count:products.length,context_count:(context||[]).length,matched,unmatched,sku_count:skuCount});
  }catch(e){return J({error:String((e as Error)?.message||e)},502)}
});
