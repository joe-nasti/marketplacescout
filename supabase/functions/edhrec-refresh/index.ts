import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const js=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const token=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const h=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
async function rpc(t:string,n:string,a:any={}){const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:h(t),body:JSON.stringify(a)});const x=await r.text();let d:any;try{d=x?JSON.parse(x):null}catch{d=x}if(!r.ok)throw Error(d?.message||`${n} failed (${r.status})`);return d}
async function upsert(t:string,rows:any[]){if(!rows.length)return;const r=await fetch(`${U}/rest/v1/edhrec_card_cache?on_conflict=user_id,scryfall_id`,{method:'POST',headers:{...h(t),Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)});if(!r.ok)throw Error(`cache upsert failed ${r.status}`)}
function role(t:string){try{const p=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,'=')))?.role||''}catch{return ''}}

Deno.serve(async r=>{
  if(r.method==='OPTIONS')return new Response('ok',{headers:C});
  if(r.method!=='POST')return js({error:'POST required'},405);
  const t=token(r);if(!t)return js({error:'Authentication required'},401);
  let body:any={};try{body=await r.json()}catch{}
  const limit=Math.max(1,Math.min(Number(body?.limit||500),2000));
  const service=role(t)==='service_role';
  const c=await rpc(t,service?'service_edhrec_refresh_candidates':'ask_collectish_edhrec_refresh_candidates',{p_limit:limit});
  const items=Array.isArray(c?.results)?c.results:[];let written=0;
  for(let i=0;i<items.length;i+=75){
    const batch=items.slice(i,i+75);
    const resp=await fetch('https://api.scryfall.com/cards/collection',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'collectish-edhrec-refresh/2.0'},body:JSON.stringify({identifiers:batch.map((x:any)=>({id:x.scryfall_id}))})});
    if(!resp.ok)throw Error(`Scryfall collection failed ${resp.status}`);
    const data=await resp.json();const byId=new Map(batch.map((x:any)=>[String(x.scryfall_id),x]));
    const rows=(data?.data||[]).map((x:any)=>{const m:any=byId.get(String(x.id))||{};return {user_id:m.user_id||undefined,scryfall_id:String(x.id),product_id:m.product_id||null,card_name:x.name||m.product_name||null,edhrec_rank:Number.isFinite(Number(x.edhrec_rank))?Number(x.edhrec_rank):null,source:'scryfall',observed_at:new Date().toISOString(),raw_json:{id:x.id,name:x.name,edhrec_rank:x.edhrec_rank}}}).filter((x:any)=>service?Boolean(x.user_id):true);
    if(!service)for(const row of rows)delete row.user_id;
    await upsert(t,rows);written+=rows.length;
    await new Promise(res=>setTimeout(res,90));
  }
  const hydrated=await rpc(t,service?'service_hydrate_scout_edhrec_from_cache':'hydrate_scout_edhrec_from_cache',{}).catch(()=>null);
  return js({ok:true,mode:service?'service':'user',candidates:items.length,written,hydrated});
});
