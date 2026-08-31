import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:H(t)});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
const regions=new Set(['US','REU','UK']),finishes=new Set(['nonfoil','foil','other']),states=new Set(['available','low_stock','sold_out','pulled','unknown']);
const types=new Set(['availability','queue','sold_out','restock','order_limit','bundle_status','shipping','tcg_market','tcg_sales','other']);
function elapsed(saleStart:string|null,at:string){if(!saleStart)return null;const n=Math.round((new Date(at).getTime()-new Date(saleStart).getTime())/60000);return Number.isFinite(n)?n:null}
async function confirm(t:string,releaseId:string){try{const r=await fetch(`${U}/functions/v1/secret-lair-confirm`,{method:'POST',headers:H(t),body:JSON.stringify({release_id:releaseId})});if(!r.ok)return null;return await r.json()}catch{return null}}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t)return J({error:'Authentication required'},401);let u:any;try{u=await auth(t)}catch{return J({error:'Authentication required'},401)}
  let b:any;try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
  const releaseId=String(b?.release_id||'');if(!releaseId)return J({error:'release_id required'},400);
  const region=regions.has(String(b?.region||'').toUpperCase())?String(b.region).toUpperCase():null;
  const finish=finishes.has(String(b?.finish||''))?String(b.finish):null;
  const availability=states.has(String(b?.availability_state||''))?String(b.availability_state):null;
  const observationType=types.has(String(b?.observation_type||''))?String(b.observation_type):(b?.bundle_offer_id?'bundle_status':'availability');
  const at=b?.observed_at?new Date(b.observed_at).toISOString():new Date().toISOString();
  try{
    const rel=await rest(t,`secret_lair_releases?select=release_id,sale_start_at&release_id=eq.${encodeURIComponent(releaseId)}&limit=1`);const release=rel?.[0];if(!release)throw Error('Release not found');
    const row:any={user_id:u.id,release_id:releaseId,drop_id:b?.drop_id||null,offer_id:b?.offer_id||null,bundle_offer_id:b?.bundle_offer_id||null,region,finish,observed_at:at,observation_type:observationType,availability_state:availability,elapsed_minutes_from_sale:elapsed(release.sale_start_at,at),source_url:b?.source_url||null,notes:b?.notes||null,metadata:{...(b?.metadata||{}),capture_source:b?.capture_source||'authenticated'}};
    const inserted=await rest(t,'secret_lair_observations',{method:'POST',prefer:'return=representation',body:[row]});
    const confirmation=await confirm(t,releaseId);
    return J({ok:true,observation:inserted?.[0]||row,confirmation});
  }catch(e){return J({error:(e as Error).message},502)}
});
