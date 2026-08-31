import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const js=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const auth=(req:Request)=>req.headers.get('authorization')||'';
const token=(req:Request)=>{const h=auth(req);return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const text=(v:any)=>String(v??'').trim();

function finishFrom(value:any){
  const s=text(value).toLowerCase();
  if(!s)return null;
  if(/etched\s*foil/.test(s))return'etched foil';
  if(/non[- ]?foil|\bnormal\b|\bregular\b/.test(s))return'nonfoil';
  if(/\bfoil\b/.test(s))return'foil';
  return null;
}
function intentFor(question:string,ctx:any){
  const q=text(question);
  const contextualFinish=finishFrom(ctx?.desired_finish||ctx?.printing||ctx?.finish||ctx?.treatment||ctx?.entity?.printing||ctx?.entity?.finish||ctx?.entity?.treatment||ctx?.signal?.printing||ctx?.signal?.finish||ctx?.signal?.treatment);
  const queryFinish=finishFrom(q);
  const allPrintings=/\ball printings\b|\ball versions\b|\bevery printing\b|\bother printings\b|\bprintings of\b/i.test(q);
  const history=/\bprice history\b|\bprice chart\b|\bhistorical price\b|\bprice trend\b/i.test(q);
  const showTreatment=/\bshow me\b|\bfind\b|\blook up\b|\bopen\b|\bprice\b|\bmarket\b|\bsales\b|\bsupply\b/i.test(q);
  const signalTreatment=Boolean(ctx?.signal)&&(contextualFinish!=null||ctx?.signal?.treatment_missing===true||ctx?.signal?.identity_missing===true);
  const recover=allPrintings||signalTreatment||Boolean(queryFinish&&(history||showTreatment));
  return {recover,allPrintings,history,desiredFinish:contextualFinish||queryFinish,signalTreatment};
}
function contextProductIds(ctx:any){
  const values=[ctx?.product_id,ctx?.productId,ctx?.entity?.product_id,ctx?.entity?.productId,ctx?.signal?.product_id,ctx?.signal?.productId];
  return [...new Set(values.map(text).filter(x=>/^\d+$/.test(x)))];
}
function queryAlias(question:string){
  let q=text(question)
    .replace(/\b(price history|price chart|historical price|price trend)\b/ig,' ')
    .replace(/\b(all printings|all versions|every printing|other printings|printings of)\b/ig,' ')
    .replace(/\b(show me|find|look up|open|price|market|sales|supply|for|of|the)\b/ig,' ')
    .replace(/\b(etched\s*foil|non[- ]?foil|foil|normal|regular)\b/ig,' ')
    .replace(/[?!.,:;]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  return q.slice(0,160);
}
async function rpc(t:string,name:string,body:any){
  const r=await fetch(`${U}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const raw=await r.text();let data:any=null;try{data=raw?JSON.parse(raw):null}catch{data=raw}
  if(!r.ok)throw Error(data?.message||`${name} failed (${r.status})`);return data;
}
async function discover(authHeader:string,productId:string,desiredFinish:string|null,reason:string){
  const r=await fetch(`${U}/functions/v1/scout-tcgplayer-sku-discovery`,{
    method:'POST',
    headers:{apikey:A,Authorization:authHeader,'Content-Type':'application/json'},
    body:JSON.stringify({product_id:productId,...(desiredFinish?{desired_finish:desiredFinish}:{}),desired_condition:'NEAR MINT',desired_language:'ENGLISH',persist:true,reason}),
  });
  const raw=await r.text();let data:any={};try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
  if(!r.ok)throw Error(data?.error||`SKU discovery failed (${r.status})`);return data;
}
async function lookupProductIds(t:string,question:string){
  const alias=queryAlias(question);
  if(!alias)return{alias,ids:[] as string[]};
  const rows=await rpc(t,'ask_collectish_public_card_lookup_v1',{p_query:alias,p_limit:50}).catch(()=>[]);
  const ids=[...new Set((Array.isArray(rows)?rows:[]).map((r:any)=>text(r?.product_id)).filter((x:string)=>/^\d+$/.test(x)))];
  return{alias,ids};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return js({error:'POST required'},405);
  const t=token(req),h=auth(req);if(!t)return js({error:'Authentication required'},401);
  let body:any;try{body=await req.json()}catch{return js({error:'Invalid JSON'},400)}
  const question=text(body?.message||body?.question),ctx=body?.context||{},intent=intentFor(question,ctx);
  if(!intent.recover)return js({ok:true,recovered:false,reason:'no_identity_recovery_intent',intent});

  let ids=contextProductIds(ctx),alias='';
  if(!ids.length){const found=await lookupProductIds(t,question);alias=found.alias;ids=found.ids}
  if(!ids.length)return js({ok:true,recovered:false,reason:'product_unresolved',intent,alias});

  const results=[] as any[];
  const failures=[] as any[];
  for(const productId of ids.slice(0,20)){
    try{
      const result=await discover(h,productId,intent.allPrintings?null:intent.desiredFinish,'ask_missing_identity_recovery');
      results.push({product_id:productId,outcome:result?.outcome||null,matches:result?.matches||[],queued_refreshes:result?.queued_refreshes||[],available_nm_english_printings:result?.available_nm_english_printings||[],materialized_nm_english_count:Number(result?.materialized_nm_english_count||0)});
    }catch(error){failures.push({product_id:productId,error:String((error as Error)?.message||error)})}
  }
  return js({ok:true,recovered:results.length>0,intent,alias,product_ids:ids,results,failures});
});
