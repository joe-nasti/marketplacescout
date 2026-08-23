import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const norm=(v:string)=>String(v||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
function dist(a:string,b:string){const x=norm(a),y=norm(b);if(x===y)return 0;if(!x.length)return y.length;if(!y.length)return x.length;let p=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const c=[i];for(let j=1;j<=y.length;j++)c[j]=Math.min(c[j-1]+1,p[j]+1,p[j-1]+(x[i-1]===y[j-1]?0:1));p=c}return p[y.length]}
function okFuzzy(a:string,b:string){const x=norm(a),y=norm(b);if(!x||!y)return false;if(x===y)return true;const d=dist(x,y),m=Math.max(x.length,y.length);return d<=2||d/m<=0.16}
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function named(name:string,mode:'exact'|'fuzzy'){try{const r=await fetch(`https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(name)}`,{headers:{'User-Agent':'MarketplaceScout/0.4 (+market intelligence reconciler)'}});if(!r.ok)return null;const c=await r.json();return c?.id?{name:String(c.name||name),id:String(c.id),set:c.set?String(c.set):null}:null}catch{return null}}
async function resolve(name:string){const exact=await named(name,'exact');if(exact)return{...exact,resolution:'exact'};const fuzzy=await named(name,'fuzzy');return fuzzy&&okFuzzy(name,fuzzy.name)?{...fuzzy,resolution:'fuzzy'}:null}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t)return J({error:'Authentication required'},401);
  try{await auth(t)}catch{return J({error:'Authentication required'},401)}
  let b:any={};try{b=await req.json()}catch{}
  const limit=Math.max(1,Math.min(Number(b?.limit)||25,100));
  try{
    const rows=await rest(t,`market_intel_entities?select=intel_entity_id,entity_name,product_id,scryfall_id,entity_type&entity_type=eq.card&scryfall_id=is.null&order=created_at.asc&limit=${limit}`)||[];
    let resolved=0,fuzzy=0,downgraded=0,failed=0;
    const results:any[]=[];
    for(const row of rows){
      try{
        const r=await resolve(String(row.entity_name||''));
        if(r){
          await rest(t,`market_intel_entities?intel_entity_id=eq.${encodeURIComponent(row.intel_entity_id)}`,{method:'PATCH',prefer:'return=minimal',body:{entity_type:'card',entity_name:r.name,scryfall_id:r.id,set_code:r.set,confidence:0.99}});
          resolved++;if(r.resolution==='fuzzy')fuzzy++;results.push({intel_entity_id:row.intel_entity_id,from:row.entity_name,to:r.name,status:r.resolution});
        }else{
          await rest(t,`market_intel_entities?intel_entity_id=eq.${encodeURIComponent(row.intel_entity_id)}`,{method:'PATCH',prefer:'return=minimal',body:{entity_type:'other',scryfall_id:null,set_code:null,confidence:Math.min(Number(row.confidence||0.5),0.5)}});
          downgraded++;results.push({intel_entity_id:row.intel_entity_id,from:row.entity_name,to:row.entity_name,status:'downgraded'});
        }
      }catch(e){failed++;results.push({intel_entity_id:row.intel_entity_id,from:row.entity_name,status:'failed',error:(e as Error).message})}
    }
    return J({ok:true,checked:rows.length,resolved,fuzzy,downgraded,failed,results});
  }catch(e){return J({error:(e as Error).message},502)}
});
