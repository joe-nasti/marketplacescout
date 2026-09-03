import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const API='https://api.tcgplayer.com';
const MAX_CHILDREN=25;
const FRESH_MS=12*60*60*1000;
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(req:Request)=>{const h=req.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};

async function user(token:string){
  const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${token}`}});
  if(!r.ok)throw Error('Unauthorized');
  const value=await r.json();
  if(!value?.id)throw Error('Unauthorized');
  return value;
}

async function sb(path:string,init:RequestInit={}){
  const r=await fetch(`${U}/rest/v1/${path}`,{...init,headers:{apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json',...(init.headers||{})}});
  const raw=await r.text();let value:any;try{value=raw?JSON.parse(raw):null}catch{value=raw}
  if(!r.ok)throw Error(value?.message||`Supabase ${r.status}`);
  return value;
}

async function tcgToken(){
  const publicKey=Deno.env.get('TCGPLAYER_PUBLIC_KEY'),privateKey=Deno.env.get('TCGPLAYER_PRIVATE_KEY');
  if(!publicKey||!privateKey)throw Error('TCGplayer pricing is not configured');
  const r=await fetch(`${API}/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:publicKey,client_secret:privateKey})});
  if(!r.ok)throw Error(`TCGplayer token ${r.status}`);
  return String((await r.json()).access_token||'');
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return json({error:'POST required'},405);
  const token=bearer(req);if(!token)return json({error:'Authentication required'},401);
  try{await user(token)}catch{return json({error:'Authentication required'},401)}
  let body:any;try{body=await req.json()}catch{return json({error:'Invalid JSON'},400)}
  const parent=String(body?.parent_sealed_uuid||'').trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parent))return json({error:'Valid parent_sealed_uuid required'},400);

  try{
    // Intentionally resolve one opened parent. There is no offset, cursor, or
    // catalog mode in this endpoint.
    const childRows=await sb(`sealed_product_child_components?select=child_sealed_uuid&parent_sealed_uuid=eq.${encodeURIComponent(parent)}&limit=100`);
    const childIds=[...new Set((childRows||[]).map((x:any)=>String(x.child_sealed_uuid||'')).filter(Boolean))];
    if(!childIds.length)return json({ok:true,parent_sealed_uuid:parent,eligible:0,requested:0,written:0});
    const products=await sb(`mtgjson_sealed_products?select=uuid,name,category,tcgplayer_product_id&category=eq.booster_pack&tcgplayer_product_id=not.is.null&uuid=in.(${childIds.join(',')})&limit=100`);
    const eligible=(products||[]).slice(0,MAX_CHILDREN);
    if(!eligible.length)return json({ok:true,parent_sealed_uuid:parent,eligible:0,requested:0,written:0});
    const eligibleIds=eligible.map((x:any)=>x.uuid).join(',');
    const existing=await sb(`sealed_product_price_current?select=sealed_uuid,captured_at&source=eq.tcgplayer_official_product&sealed_uuid=in.(${eligibleIds})`);
    const fresh=new Set((existing||[]).filter((x:any)=>Date.now()-new Date(x.captured_at).getTime()<FRESH_MS).map((x:any)=>String(x.sealed_uuid)));
    const targets=eligible.filter((x:any)=>!fresh.has(String(x.uuid))).slice(0,MAX_CHILDREN);
    if(!targets.length)return json({ok:true,parent_sealed_uuid:parent,eligible:eligible.length,requested:0,written:0,cached:eligible.length});

    const byProduct=new Map(targets.map((x:any)=>[String(x.tcgplayer_product_id),x]));
    const access=await tcgToken();
    const response=await fetch(`${API}/pricing/product/${[...byProduct.keys()].join(',')}`,{headers:{Authorization:`bearer ${access}`}});
    if(!response.ok&&response.status!==207)throw Error(`TCGplayer pricing ${response.status}`);
    const payload=await response.json(),grouped=new Map<string,any[]>();
    for(const row of payload.results||[]){const id=String(row.productId);if(!grouped.has(id))grouped.set(id,[]);grouped.get(id)!.push(row)}
    const capturedAt=new Date().toISOString(),rows:any[]=[];
    for(const [productId,values] of grouped){
      const product=byProduct.get(productId);if(!product)continue;
      const price=values.find((x:any)=>String(x.subTypeName||'').toLowerCase()==='normal'&&(x.lowPrice!=null||x.marketPrice!=null))||values.find((x:any)=>x.lowPrice!=null||x.marketPrice!=null);
      if(!price||!(Number(price.lowPrice)>0))continue;
      rows.push({sealed_uuid:product.uuid,source:'tcgplayer_official_product',product_id:productId,product_name:product.name||null,market_price:price.marketPrice??null,low_price:price.lowPrice,low_with_shipping:null,total_listings:null,captured_at:capturedAt,raw_json:{provider:'tcgplayer_official',endpoint:'pricing/product',subTypeName:price.subTypeName||null,directLowPrice:price.directLowPrice??null,shippingAware:false,refresh_scope:'opened_parent_children',parent_sealed_uuid:parent}});
    }
    if(rows.length)await sb('sealed_product_price_current?on_conflict=sealed_uuid,source',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)});
    return json({ok:true,parent_sealed_uuid:parent,eligible:eligible.length,requested:targets.length,written:rows.length,cached:eligible.length-targets.length});
  }catch(error){console.error('sealed-child-price-refresh',parent,error);return json({error:String((error as Error)?.message||error)},502)}
});
