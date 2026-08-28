import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
const enc=(x:any)=>encodeURIComponent(String(x??''));

async function serviceAuth(token:string){
  if(!token)return false;
  if(S&&token===S)return true;
  try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:token,Authorization:`Bearer ${token}`}});return r.ok}catch{return false}
}
async function rest(path:string,opt:any={}){
  const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});
  const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}
  if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d;
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!S||!(await serviceAuth(token)))return J({error:'Service authentication required'},401);
  let body:any={};try{body=await req.json()}catch{}
  const minConv=Math.max(.75,Math.min(.99,Number(body.min_conviction??.85)));
  const limit=Math.max(1,Math.min(30,Number(body.limit??12)));
  const cooldownHours=Math.max(1,Math.min(48,Number(body.cooldown_hours??6)));
  const cutoff=new Date(Date.now()-7*86400000).toISOString();
  const cooldownCutoff=new Date(Date.now()-cooldownHours*3600000).toISOString();
  try{
    const rels=await rest(`market_intel_card_relationships?select=relationship_id,user_id,target_card_name,target_scryfall_id,source_card_name,source_name,source_url,source_video_id,conviction,created_at&target_is_actionable=eq.true&conviction=gte.${minConv}&created_at=gte.${enc(cutoff)}&order=conviction.desc,created_at.desc&limit=${limit*3}`);
    const seen=new Set<string>(),targets:any[]=[];
    for(const r of rels||[]){const key=`${r.user_id}|${r.target_scryfall_id}`;if(!r.target_scryfall_id||seen.has(key))continue;seen.add(key);targets.push(r);if(targets.length>=limit)break}
    let queued=0,refreshed=0,skippedCooldown=0,noCatalog=0;const details:any[]=[];
    for(const r of targets){
      const catalog=await rest(`scout_card_catalog?select=sku_id,product_id,printing&scryfall_id=eq.${enc(r.target_scryfall_id)}&order=sku_id.asc&limit=8`).catch(()=>[]);
      const ordered=(catalog||[]).sort((a:any,b:any)=>{const an=/^(normal|non foil|nonfoil)$/i.test(String(a.printing||''))?0:1,bn=/^(normal|non foil|nonfoil)$/i.test(String(b.printing||''))?0:1;return an-bn||String(a.sku_id).localeCompare(String(b.sku_id))}).slice(0,4);
      if(!ordered.length){noCatalog++;details.push({card:r.target_card_name,status:'no_catalog'});continue}
      let targetQueued=0;
      for(const c of ordered){
        const state=await rest(`scout_card_state?select=refresh_requested_at&user_id=eq.${enc(r.user_id)}&sku_id=eq.${enc(c.sku_id)}&limit=1`).catch(()=>[]);
        if(state?.[0]?.refresh_requested_at&&state[0].refresh_requested_at>=cooldownCutoff){skippedCooldown++;continue}
        const reason=`creator_synergy:${String(r.source_card_name||'new_card').slice(0,72)}`;
        await rest('scout_card_state',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{user_id:r.user_id,sku_id:String(c.sku_id),coverage_state:'catalog',refresh_requested_at:new Date().toISOString(),wake_reason:reason,updated_at:new Date().toISOString()}});
        const open=await rest(`scout_refresh_queue?select=queue_id,priority&user_id=eq.${enc(r.user_id)}&sku_id=eq.${enc(c.sku_id)}&status=in.(queued,claimed)&limit=1`).catch(()=>[]);
        const priority=Math.max(70,Math.min(98,Math.round(Number(r.conviction||0)*100)));
        const meta={trigger:'creator_synergy',relationship_id:r.relationship_id,source_card:r.source_card_name,target_card:r.target_card_name,source_name:r.source_name,source_url:r.source_url,source_video_id:r.source_video_id,conviction:r.conviction,scryfall_id:r.target_scryfall_id};
        if(open?.[0]?.queue_id){await rest(`scout_refresh_queue?queue_id=eq.${open[0].queue_id}`,{method:'PATCH',body:{priority:Math.max(priority,Number(open[0].priority||0)),reason,requested_at:new Date().toISOString(),metadata_json:meta}})}
        else await rest('scout_refresh_queue',{method:'POST',prefer:'return=minimal',body:{user_id:r.user_id,sku_id:String(c.sku_id),reason,priority,status:'queued',metadata_json:meta}});
        queued++;targetQueued++;
      }
      if(targetQueued)refreshed++;
      details.push({card:r.target_card_name,source_card:r.source_card_name,conviction:r.conviction,skus_queued:targetQueued});
    }
    return J({ok:true,targets_considered:targets.length,targets_woken:refreshed,skus_queued:queued,skipped_cooldown:skippedCooldown,no_catalog:noCatalog,min_conviction:minConv,cooldown_hours:cooldownHours,details});
  }catch(e){return J({error:(e as Error).message},502)}
});
