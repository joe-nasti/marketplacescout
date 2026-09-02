import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const API='https://api.tcgplayer.com';
const SEARCH='https://mp-search-api.tcgplayer.com';
const INFINITE='https://infinite-api.tcgplayer.com';
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
async function jf(url:string,opt:any={}){
  const a=new AbortController(),tm=setTimeout(()=>a.abort(),12000);
  try{const r=await fetch(url,{...opt,headers:{Accept:'application/json','Content-Type':'application/json',...(opt.headers||{})},signal:a.signal});const t=await r.text();if(!r.ok)throw Error(`${r.status} ${t.slice(0,180)}`);return t?JSON.parse(t):null}
  finally{clearTimeout(tm)}
}
const norm=(s:any)=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
function ids(x:any,o=new Set<string>()){if(x==null)return o;if(Array.isArray(x)){for(const v of x)ids(v,o);return o}if(typeof x==='object')for(const[k,v]of Object.entries(x)){if(/productid/i.test(k)&&/^\d+$/.test(String(v)))o.add(String(v));ids(v,o)}return o}
function valuesForKeys(x:any,re:RegExp,out:string[]=[]){if(x==null)return out;if(Array.isArray(x)){for(const v of x)valuesForKeys(v,re,out);return out}if(typeof x==='object')for(const[k,v]of Object.entries(x)){if(re.test(k)&&['string','number'].includes(typeof v))out.push(String(v));valuesForKeys(v,re,out)}return out}

async function search(q:string){
  const b={algorithm:'revenue_dismax',from:0,size:18,filters:{term:{},range:{},match:{}},listingSearch:{context:{cart:{}},filters:{term:{sellerStatus:'Live',channelId:0},range:{quantity:{gte:1}},exclude:{channelExclusion:0}}},context:{cart:{},shippingCountry:'US'},settings:{useFuzzySearch:true,didYouMean:{}},sort:{}};
  return [...ids(await jf(`${SEARCH}/v1/search/request?q=${encodeURIComponent(q)}&isList=false`,{method:'POST',body:JSON.stringify(b)}))].slice(0,6);
}
async function details(id:string){const d=await jf(`${SEARCH}/v2/product/${id}/details`);return d?.result||d}
function score(p:any,d:any){
  const pn=norm(d?.productName||d?.name),target=norm(p.card_name),set=norm(d?.setName||d?.groupName||''),code=norm(d?.setCode||'');
  const magic=Number(d?.productLineId)===1||norm(d?.productLineName).includes('magic');
  const cardProduct=Number(d?.productTypeId)===1||norm(d?.productTypeName)==='cards';
  const nums=valuesForKeys(d,/collector|number/i).map(norm);
  const exactName=pn===target||pn.startsWith(target+' ')||pn.endsWith(' '+target);
  const zetaSet=code==='slz'||set.includes('zeta')||set.includes('mschf')||norm(JSON.stringify(d)).includes('secret lair x mschf');
  const cn=norm(p.collector_number),numberOk=nums.some(x=>x===cn||x.endsWith(' '+cn));
  const sc=(exactName?.55:0)+(magic?.10:0)+(cardProduct?.08:0)+(zetaSet?.17:0)+(numberOk?.10:0);
  return{score:Math.min(1,sc),exactName,magic,cardProduct,zetaSet,numberOk,numberEvidence:nums.slice(0,12),setCode:d?.setCode||null};
}

let tokenCache:string|null=null,tokenUntil=0;
async function token(){
  if(tokenCache&&Date.now()<tokenUntil)return tokenCache;
  const a=Deno.env.get('TCGPLAYER_PUBLIC_KEY'),b=Deno.env.get('TCGPLAYER_PRIVATE_KEY');if(!a||!b)throw Error('missing_tcgplayer_secrets');
  const r=await fetch(`${API}/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:a,client_secret:b})});if(!r.ok)throw Error(`tcg_token_${r.status}`);
  const j=await r.json();tokenCache=j.access_token;tokenUntil=Date.now()+Math.max(60000,(Number(j.expires_in||3600)-60)*1000);return tokenCache!;
}
async function officialSkus(id:string){const t=await token(),r=await fetch(`${API}/catalog/products/${id}/skus`,{headers:{Authorization:`bearer ${t}`,Accept:'application/json'}});if(!r.ok)throw Error(`sku_${r.status}`);const j=await r.json();return (j.results||[]).map((x:any)=>String(x.skuId)).filter((x:string)=>/^\d+$/.test(x))}
async function prices(id:string,skus:string[]){
  if(!skus.length)return 0;const t=await token(),rows:any[]=[];
  for(let i=0;i<skus.length;i+=50){const part=skus.slice(i,i+50),r=await fetch(`${API}/pricing/sku/${part.join(',')}`,{headers:{Authorization:`bearer ${t}`}});if(!r.ok)continue;const j=await r.json();for(const x of j.results||[])rows.push({sku_id:String(x.skuId),product_id:id,low_price:x.lowPrice,lowest_shipping:x.lowestShipping,lowest_listing_price:x.lowestListingPrice,market_price:x.marketPrice,direct_low_price:x.directLowPrice,observed_at:new Date().toISOString(),source:'zeta_tcgplayer_discovery'})}
  if(rows.length){await rest('tcgplayer_official_sku_price_current?on_conflict=sku_id',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:rows});const hist=rows.map(x=>({...x,observed_hour:new Date(x.observed_at).toISOString().slice(0,13)+':00:00.000Z'}));await rest('tcgplayer_official_sku_price_history?on_conflict=sku_id,observed_hour',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:hist}).catch(()=>null)}
  return rows.length;
}
async function history(user:string,id:string){const h=await jf(`${INFINITE}/price/history/${id}/detailed?range=quarter`).catch(()=>null),res=Array.isArray(h?.result)?h.result:[];if(res.length)await rpc('apply_marketplace_sales_history',{p_user_id:user,p_product_id:id,p_result:res,p_source:'secret_lair_zeta_market_sync'}).catch(()=>null);return res.length}
async function save(p:any,best:any,q:string,status:string){
  const now=new Date().toISOString(),keep=status==='candidate'||status==='confirmed',skus=status==='confirmed'?await officialSkus(best.id).catch(()=>[]):[];
  await rest('secret_lair_randomized_tcgplayer_printings?on_conflict=user_id,randomized_card_printing_id',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:[{user_id:p.user_id,randomized_product_id:p.randomized_product_id,randomized_card_printing_id:p.randomized_card_printing_id,tcgplayer_product_id:keep?best?.id||null:null,tcgplayer_sku_ids:skus,product_name:keep?best?.d?.productName||null:null,set_name:keep?best?.d?.setName||null:null,discovery_query:q,discovery_confidence:keep?best?.s?.score||0:0,discovery_status:status,discovery_source:'mp_search_exact_slz',first_seen_at:status==='confirmed'?now:null,last_seen_at:status==='confirmed'?now:null,last_attempt_at:now,details:keep?best?.d||{}:{},updated_at:now}]});
  if(status==='confirmed'){await prices(best.id,skus).catch(()=>0);await history(p.user_id,best.id).catch(()=>0)}return skus;
}

function ageMs(e:any){const t=Date.parse(e?.last_attempt_at||'');return Number.isFinite(t)?Date.now()-t:Number.POSITIVE_INFINITY}
function isHot(p:any){return p.rarity==='mythic'||(p.rarity==='rare'&&p.treatment_canonical_name!=='Photocopy')||p.treatment_canonical_name==='Color Banding'}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return J({error:'POST required'},405);
  if(!(await cronOk(req.headers.get('x-collectish-cron-key')||'')))return J({error:'Unauthorized'},401);
  try{
    let body:any={};try{body=await req.json()}catch{}
    const limit=Math.max(1,Math.min(16,Number(body?.limit||12))),hotSlots=Math.min(3,Math.max(0,limit-1));
    const rows=await rest('secret_lair_randomized_tcg_discovery_context?select=user_id,randomized_product_id,randomized_card_printing_id,card_name,rarity,collector_number,treatment_canonical_name&limit=500');
    const existing=await rest('secret_lair_randomized_tcgplayer_printings?select=randomized_card_printing_id,discovery_status,last_attempt_at&limit=1000').catch(()=>[]),em=new Map((existing||[]).map((x:any)=>[x.randomized_card_printing_id,x]));
    const unresolved=(rows||[]).filter((p:any)=>em.get(p.randomized_card_printing_id)?.discovery_status!=='confirmed');
    // Rolling coverage: never-attempted rows first, then oldest attempt. This guarantees
    // every SLZ printing advances instead of repeatedly starving commons behind mythics.
    const rolling=[...unresolved].sort((a:any,b:any)=>{
      const ea=em.get(a.randomized_card_printing_id),eb=em.get(b.randomized_card_printing_id),aa=ageMs(ea),ab=ageMs(eb);
      if(aa!==ab)return ab-aa;
      return Number(a.collector_number)-Number(b.collector_number);
    });
    // Reserve a few slots for chase / rare-treatment rechecks once they are 20m stale.
    const hot=rolling.filter((p:any)=>isHot(p)&&ageMs(em.get(p.randomized_card_printing_id))>=20*60*1000).slice(0,hotSlots);
    const picked=new Set(hot.map((p:any)=>p.randomized_card_printing_id));
    const todo=[...hot,...rolling.filter((p:any)=>!picked.has(p.randomized_card_printing_id)).slice(0,Math.max(0,limit-hot.length))],report:any[]=[];
    for(const p of todo){
      const q=`${p.card_name} ${p.collector_number} SLZ`,found=await search(q).catch(()=>[]);let best:any=null;
      for(const id of found){const d=await details(id).catch(()=>null);if(!d)continue;const s=score(p,d);if(!best||s.score>best.s.score)best={id,d,s};if(s.score>=1&&s.exactName&&s.magic&&s.cardProduct&&s.zetaSet&&s.numberOk)break}
      let status='not_found';if(best?.s?.exactName&&best.s.magic&&best.s.cardProduct&&best.s.zetaSet)status=best.s.numberOk?'confirmed':'candidate';
      const skus=await save(p,best||{id:null,d:null,s:{score:0}},q,status);
      report.push({card:p.card_name,collector_number:p.collector_number,treatment:p.treatment_canonical_name,status,score:status==='not_found'?0:Number(best.s.score.toFixed(3)),product_id:status==='not_found'?null:best?.id||null,set_code:best?.s?.setCode||null,number_match:best?.s?.numberOk||false,sku_count:skus.length,queue:isHot(p)?'hot_or_roll':'roll'});
    }
    const allExisting=await rest('secret_lair_randomized_tcgplayer_printings?select=randomized_card_printing_id,discovery_status,last_attempt_at&limit=1000').catch(()=>[]),summary:any={};for(const x of allExisting||[])summary[x.discovery_status]=(summary[x.discovery_status]||0)+1;
    const attempted=new Set((allExisting||[]).filter((x:any)=>x.last_attempt_at).map((x:any)=>x.randomized_card_printing_id));
    return J({ok:true,checked:report.length,total_printings:(rows||[]).length,attempted_printings:attempted.size,remaining_never_attempted:Math.max(0,(rows||[]).length-attempted.size),summary,report});
  }catch(e){return J({error:String((e as Error)?.message||e)},502)}
});
