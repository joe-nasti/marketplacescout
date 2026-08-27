import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=()=>({apikey:S||A,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function rpc(name:string,args:any={}){return rest(`rpc/${name}`,{method:'POST',body:args})}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t||!(await serviceAuth(t)))return J({error:'Service authentication required'},401);if(!S)return J({error:'Service role unavailable'},500);
  let body:any={};try{body=await req.json()}catch{}
  const limit=Math.max(1,Math.min(100,Number(body?.limit)||40));
  try{
    const events=await rest(`market_intel_video_events?select=intel_id,user_id,created_at&order=created_at.desc&limit=${limit}`);
    const pairs=[...new Map((events||[]).map((x:any)=>[`${x.user_id}|${x.intel_id}`,x])).values()] as any[];
    let checked=0,future=0,patched=0,missing=0;
    for(const p of pairs){
      const entities=await rest(`market_intel_entities?select=scryfall_id,entity_name,set_code&user_id=eq.${encodeURIComponent(p.user_id)}&intel_id=eq.${encodeURIComponent(p.intel_id)}&entity_type=eq.card&limit=4`).catch(()=>[]);
      for(const e of entities||[]){
        if(!e?.scryfall_id){missing++;continue}checked++;
        let card:any=null;try{const r=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(e.scryfall_id)}`,{headers:{'User-Agent':'MarketplaceScout/1.3 (+future card thesis lifecycle)'}});if(r.ok)card=await r.json()}catch{}
        if(!card?.released_at)continue;
        const items=await rest(`market_intel_items?select=metadata_json,published_at,observed_at,created_at&user_id=eq.${encodeURIComponent(p.user_id)}&intel_id=eq.${encodeURIComponent(p.intel_id)}&limit=1`).catch(()=>[]);
        const item=items?.[0];if(!item)continue;
        const signalDate=String(item.published_at||item.observed_at||item.created_at||'').slice(0,10);
        const isFuture=!!signalDate&&String(card.released_at)>signalDate;
        if(isFuture)future++;
        const metadata={...(item.metadata_json||{}),card_release_date:String(card.released_at),card_oracle_id:card.oracle_id||null,captured_as_unreleased:isFuture,release_lifecycle_enriched_at:new Date().toISOString()};
        await rest(`market_intel_items?user_id=eq.${encodeURIComponent(p.user_id)}&intel_id=eq.${encodeURIComponent(p.intel_id)}`,{method:'PATCH',body:{metadata_json:metadata}});
        patched++;
      }
    }
    const refreshed=await rpc('refresh_future_card_theses',{}).catch(()=>0);
    return J({ok:true,events_considered:pairs.length,cards_checked:checked,future_cards_detected:future,items_patched:patched,missing_identity:missing,theses_refreshed:Number(refreshed)||0});
  }catch(e){return J({error:(e as Error).message},502)}
});
