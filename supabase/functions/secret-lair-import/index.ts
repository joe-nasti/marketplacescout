import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const allowedRegions=new Set(['US','REU','UK']);
const clean=(x:any,n=1000)=>String(x??'').trim().slice(0,n);
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:H(t)});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function slug(s:string){return clean(s,240).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function region(v:any){const r=clean(v,8).toUpperCase();if(!allowedRegions.has(r))throw Error(`Unsupported region ${r||'(blank)'}`);return r}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t)return J({error:'Authentication required'},401);
  let user:any;try{user=await auth(t)}catch{return J({error:'Authentication required'},401)}
  let b:any;try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
  const release=b?.release||{};const name=clean(release.release_name||release.name,300);if(!name)return J({error:'release.name required'},400);
  try{
    const releaseRows=await rest(t,'secret_lair_releases?on_conflict=user_id,release_name',{method:'POST',prefer:'resolution=merge-duplicates,return=representation',body:[{user_id:user.id,release_name:name,release_slug:clean(release.release_slug||slug(name),300),official_url:clean(release.official_url,2000)||null,announced_at:release.announced_at||null,sale_start_at:release.sale_start_at||null,sale_end_at:release.sale_end_at||null,sale_format:clean(release.sale_format,40)||'unknown',supply_confidence:Number.isFinite(Number(release.supply_confidence))?Number(release.supply_confidence):0.25,supply_notes:clean(release.supply_notes,3000)||null,preorder_or_queue_notes:clean(release.preorder_or_queue_notes,3000)||null,promo_notes:clean(release.promo_notes,3000)||null,bundle_notes:clean(release.bundle_notes,3000)||null,lifecycle_state:clean(release.lifecycle_state,40)||'announced'}]});
    const releaseId=releaseRows?.[0]?.release_id;if(!releaseId)throw Error('Unable to persist release');

    const regionRows=[];for(const rr of (b?.regions||[])){regionRows.push({release_id:releaseId,user_id:user.id,region:region(rr.region),storefront_url:clean(rr.storefront_url,2000)||null,currency:clean(rr.currency,8)||'USD',sale_start_at:rr.sale_start_at||release.sale_start_at||null,sale_end_at:rr.sale_end_at||release.sale_end_at||null,queue_start_at:rr.queue_start_at||null,order_limit_notes:clean(rr.order_limit_notes,2000)||null,shipping_notes:clean(rr.shipping_notes,2000)||null,regional_supply_notes:clean(rr.regional_supply_notes,2000)||null})}
    if(regionRows.length)await rest(t,'secret_lair_release_regions?on_conflict=release_id,region',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:regionRows});

    const persistedDrops=[];
    for(const d of (b?.drops||[])){
      const dropName=clean(d.drop_name||d.name,300);if(!dropName)continue;
      const rows=await rest(t,'secret_lair_drops?on_conflict=release_id,drop_name',{method:'POST',prefer:'resolution=merge-duplicates,return=representation',body:[{release_id:releaseId,user_id:user.id,drop_name:dropName,ip_name:clean(d.ip_name,250)||null,artist_name:clean(d.artist_name,250)||null,treatment_name:clean(d.treatment_name,250)||null,nonfoil_msrp:d.nonfoil_msrp??null,foil_msrp:d.foil_msrp??null,currency:clean(d.currency,8)||'USD',distribution_notes:clean(d.distribution_notes,2500)||null,wpn_nonfoil:Boolean(d.wpn_nonfoil),mechanically_unique_count:Number(d.mechanically_unique_count||0),included_in_bundle:d.included_in_bundle!==false}]});
      const dropId=rows?.[0]?.drop_id;if(!dropId)continue;
      await rest(t,`secret_lair_drop_cards?drop_id=eq.${dropId}`,{method:'DELETE'}).catch(()=>null);
      const cards=(d.cards||[]).map((c:any)=>({drop_id:dropId,user_id:user.id,card_name:clean(c.card_name||c.name,300),display_name:clean(c.display_name,300)||null,scryfall_id:c.scryfall_id||null,oracle_id:c.oracle_id||null,is_token:Boolean(c.is_token),is_mechanically_unique:Boolean(c.is_mechanically_unique),is_bonus_card:Boolean(c.is_bonus_card),collector_number:clean(c.collector_number,40)||null,notes:clean(c.notes,1200)||null})).filter((c:any)=>c.card_name);
      if(cards.length)await rest(t,'secret_lair_drop_cards',{method:'POST',prefer:'return=minimal',body:cards});
      for(const o of (d.offers||[]))await rest(t,'secret_lair_drop_offers?on_conflict=drop_id,region,finish,distribution_channel',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:[{release_id:releaseId,drop_id:dropId,user_id:user.id,region:region(o.region),finish:clean(o.finish,20)||'other',currency:clean(o.currency,8)||'USD',price:o.price??null,product_url:clean(o.product_url,2000)||null,external_product_id:clean(o.external_product_id,200)||null,sale_format:clean(o.sale_format,40)||release.sale_format||'unknown',available_from:o.available_from||null,available_until:o.available_until||null,order_limit:o.order_limit??null,distribution_channel:clean(o.distribution_channel,40)||'secret_lair',metadata:o.metadata||{}}]});
      persistedDrops.push({drop_id:dropId,drop_name:dropName});
    }
    return J({ok:true,release_id:releaseId,release_name:name,regions:regionRows.map(x=>x.region),drops:persistedDrops});
  }catch(e){return J({error:(e as Error).message},502)}
});
