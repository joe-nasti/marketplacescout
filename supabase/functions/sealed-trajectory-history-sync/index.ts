import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const C={'Content-Type':'application/json'};
const SB=Deno.env.get('SUPABASE_URL')||'';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const TCG='https://infinite-api.tcgplayer.com';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:C});
const rest=async(path:string,init:RequestInit={})=>{const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation',...(init.headers||{})}});const t=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${t.slice(0,240)}`);return t?JSON.parse(t):null};
const cronOk=async(key:string)=>!!key&&(await rest('rpc/verify_collectish_cron_key',{method:'POST',body:JSON.stringify({p_key:key})}).catch(()=>false))===true;
const fetchHistory=async(productId:string,requested:string)=>{const ranges=requested==='year'?['year','quarter']:[requested];const attempts=[];for(const range of ranges){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),20000);try{const r=await fetch(`${TCG}/price/history/${encodeURIComponent(productId)}/detailed?range=${encodeURIComponent(range)}`,{headers:{Accept:'application/json','User-Agent':'MarketplaceScout/1.0 (+sealed trajectory research)'},signal:ctl.signal});const t=await r.text();if(!r.ok){attempts.push({range,status:r.status,detail:t.slice(0,120)});continue}const j=t?JSON.parse(t):{},result=Array.isArray(j?.result)?j.result:[];if(result.length)return{result,range,attempts};attempts.push({range,status:r.status,detail:'empty result'})}catch(error){attempts.push({range,status:0,detail:String((error as Error)?.message||error).slice(0,120)})}finally{clearTimeout(timer)}}throw new Error(`TCGplayer history unavailable: ${JSON.stringify(attempts)}`)};

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return json({error:'POST required'},405);
  if(!(await cronOk(req.headers.get('x-collectish-cron-key')||'')))return json({error:'unauthorized'},401);
  try{
    const body=await req.json().catch(()=>({})),limit=Math.max(1,Math.min(20,Number(body?.limit)||8));
    const range=['quarter','year'].includes(String(body?.range))?String(body.range):'year';
    const queue=await rest(`sealed_product_trajectory_backfill_queue?select=user_id,sealed_uuid,product_id,name,history_days&order=history_days.asc,release_date.desc&limit=${limit}`)||[];
    const report=[];
    for(const item of queue){
      try{
        const live=await fetchHistory(String(item.product_id),range),result=live.result;
        await rest('rpc/apply_marketplace_sales_history',{method:'POST',body:JSON.stringify({p_user_id:item.user_id,p_product_id:String(item.product_id),p_result:result,p_source:`sealed_trajectory_${live.range}`})});
        const skuCount=result.length,bucketCount=result.reduce((n:number,x:any)=>n+(Array.isArray(x?.buckets)?x.buckets.length:0),0);
        report.push({sealed_uuid:item.sealed_uuid,product_id:item.product_id,name:item.name,ok:true,requested_range:range,returned_range:live.range,attempts:live.attempts,sku_count:skuCount,bucket_count:bucketCount});
      }catch(error){report.push({sealed_uuid:item.sealed_uuid,product_id:item.product_id,name:item.name,ok:false,error:String((error as Error)?.message||error).slice(0,200)})}
    }
    return json({ok:true,processed:report.length,succeeded:report.filter(x=>x.ok).length,report});
  }catch(error){return json({error:String((error as Error)?.message||error)},500)}
});
