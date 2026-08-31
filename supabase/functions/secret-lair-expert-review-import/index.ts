import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const clean=(x:any,n=4000)=>String(x??'').trim().slice(0,n);
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:H(t)});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function ratingScore(r:any){const n=Math.max(1,Math.min(10,Math.round(Number(r)||1)));return ({1:8,2:16,3:24,4:34,5:44,6:56,7:68,8:80,9:91,10:98} as any)[n]}
const dims=new Set(['card_quality','anchor_strength','playable_depth','staple_breadth','obscurity','art','treatment','version_of_choice','premium_competition','ip_heat','ip_fit','cute_meme_nostalgia','supply','sale_mechanics','distribution','wait_aversion','promo','bundle','merchandise','value','liquidity','reprint_risk','sell_through','other']);

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return J({error:'POST required'},405);
 const t=bearer(req);if(!t)return J({error:'Authentication required'},401);let u:any;try{u=await auth(t)}catch{return J({error:'Authentication required'},401)}
 let b:any;try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
 const releaseName=clean(b?.release_name,300);const reviewer=clean(b?.reviewer||'Expert Review',200);if(!releaseName)return J({error:'release_name required'},400);
 try{
   const releases=await rest(t,`secret_lair_releases?select=release_id&user_id=eq.${u.id}&release_name=eq.${encodeURIComponent(releaseName)}&limit=1`);const releaseId=releases?.[0]?.release_id;if(!releaseId)throw Error('Release not found; import catalog first');
   const drops=await rest(t,`secret_lair_drops?select=drop_id,drop_name&release_id=eq.${releaseId}`);const byName=new Map((drops||[]).map((d:any)=>[String(d.drop_name).toLowerCase(),d]));let saved=0;
   for(const review of (b?.reviews||[])){
     const drop=byName.get(clean(review.drop_name,300).toLowerCase());if(!drop)continue;const rating=Number(review.rating);const assertions=Array.isArray(review.assertions)&&review.assertions.length?review.assertions:[{dimension:'other',direction:'neutral',summary:clean(review.thesis,2500)}];
     for(const a of assertions){const dim=dims.has(clean(a.dimension,80))?clean(a.dimension,80):'other';await rest(t,'secret_lair_evidence',{method:'POST',prefer:'return=minimal',body:[{user_id:u.id,release_id:releaseId,drop_id:drop.drop_id,source_type:'expert_review',source_name:reviewer,author:reviewer,observed_at:review.observed_at||new Date().toISOString(),published_at:review.published_at||null,evidence_class:'expert_opinion',claim_dimension:dim,direction:['bullish','bearish','neutral'].includes(clean(a.direction,20))?clean(a.direction,20):'neutral',confidence:Number.isFinite(Number(a.confidence))?Number(a.confidence):0.85,normalized_score:Number.isFinite(rating)?ratingScore(rating):null,summary:clean(a.summary||review.thesis,3000),raw_rating:Number.isFinite(rating)?rating:null,raw_rating_scale:Number.isFinite(rating)?10:null,metadata:{reviewer,drop_rating:Number.isFinite(rating)?rating:null,thesis:clean(review.thesis,5000),source_label:clean(review.source_label,200)||'Discord review',tags:Array.isArray(a.tags)?a.tags:[]}}]});saved++}
   }
   return J({ok:true,release_id:releaseId,release_name:releaseName,reviewer,evidence_rows_saved:saved});
 }catch(e){return J({error:(e as Error).message},502)}
});
