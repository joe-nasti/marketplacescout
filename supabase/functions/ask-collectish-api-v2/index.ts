import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const API_SCHEMA='collectish.ask.api.v1';
const SURFACE_SCHEMA='collectish.ask.surface.v10';
const text=(v:any)=>String(v??'').trim();
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const auth=(r:Request)=>r.headers.get('authorization')||'';
const headers=(authorization:string)=>({apikey:A,Authorization:authorization,'Content-Type':'application/json'});
async function parse(r:Response){const raw=await r.text();try{return raw?JSON.parse(raw):null}catch{return raw}}
async function rest(authorization:string,path:string,o:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:o.method||'GET',headers:{...headers(authorization),...(o.prefer?{Prefer:o.prefer}:{})},body:o.body===undefined?undefined:JSON.stringify(o.body)}),d:any=await parse(r);if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function fn(authorization:string,name:string,body:any){const r=await fetch(`${U}/functions/v1/${name}`,{method:'POST',headers:headers(authorization),body:JSON.stringify(body)}),d:any=await parse(r);if(!r.ok)throw Error(d?.error||`${name} ${r.status}`);return d}
async function proxyLegacy(authorization:string,body:any){const r=await fetch(`${U}/functions/v1/ask-collectish-api`,{method:'POST',headers:headers(authorization),body:JSON.stringify(body)});const raw=await r.text();return new Response(raw,{status:r.status,headers:{...C,'Content-Type':r.headers.get('content-type')||'application/json','Cache-Control':'no-store'}})}
async function ensureSession(authorization:string,id:any,title:string){const cid=text(id);if(cid){const rows=await rest(authorization,`ask_collectish_conversations?id=eq.${encodeURIComponent(cid)}&select=id&limit=1`).catch(()=>[]);if(rows?.[0]?.id)return String(rows[0].id)}const rows=await rest(authorization,'ask_collectish_conversations',{method:'POST',prefer:'return=representation',body:[{title:text(title).slice(0,90)||'New conversation'}]});if(!rows?.[0]?.id)throw Error('Ask session was not created');return String(rows[0].id)}
async function save(authorization:string,cid:string,role:string,content:string,metadata:any={}){if(!content)return;await rest(authorization,'ask_collectish_messages',{method:'POST',prefer:'return=minimal',body:[{conversation_id:cid,role,content,metadata}]})}
async function touch(authorization:string,cid:string){await rest(authorization,`ask_collectish_conversations?id=eq.${encodeURIComponent(cid)}`,{method:'PATCH',body:{updated_at:new Date().toISOString()}}).catch(()=>null)}
function compactPresentation(p:any){if(!p||typeof p!=='object')return null;return {...p,sections:(p.sections||[]).map((s:any)=>({...s,rows:Array.isArray(s.rows)?s.rows.map((r:any)=>({...r,raw:r?.raw?{product_id:r.raw.product_id??null,sku_id:r.raw.sku_id??null,set_code:r.raw.set_code??null,printing:r.raw.printing??null}:undefined})):s.rows}))}}
function surfacesFor(d:any){const original=Array.isArray(d?.surfaces)?d.surfaces.slice(0,4):[];const p=compactPresentation(d?.presentation);if(p)original.unshift({type:'delvin_shared_report',domain:'collectish',...p});return original.slice(0,6)}
function enrichmentHint(d:any){if(d?.route!=='collectible_cohort_thesis')return null;const x=d?.data||{},s=x?.summary||x?.basket||x;const treatment=text(s?.treatment||x?.treatment);const setCodes=(Array.isArray(s?.set_codes)?s.set_codes:Array.isArray(x?.set_codes)?x.set_codes:[]).map(text).filter(Boolean);if(!treatment)return null;return{kind:'collectible_history',route:'collectible_cohort_thesis',treatment,set_codes:setCodes,async_enrichment:true}}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return json({api_schema:API_SCHEMA,error:'POST required'},405);
  const authorization=auth(req);if(!authorization)return json({api_schema:API_SCHEMA,error:'Authentication required'},401);
  const body=await req.json().catch(()=>null);if(!body)return json({api_schema:API_SCHEMA,error:'Invalid JSON'},400);
  const action=text(body.action||'chat').toLowerCase();
  if(action!=='chat'||body?.guest===true)return proxyLegacy(authorization,body);
  const question=text(body.message||body.question);if(!question)return proxyLegacy(authorization,body);
  try{
    const routed=await fn(authorization,'ask-collectish-delvin-present-v3',{question,context:body.context||null,client:'web'}).catch(()=>null);
    if(!routed?.handled||!routed?.response)return proxyLegacy(authorization,body);
    const cid=await ensureSession(authorization,body.conversation_id||body.session_id,question);
    const surfaces=surfacesFor(routed),async_enrichment=enrichmentHint(routed);
    await save(authorization,cid,'user',question,{screen:body?.context?.screen||'unknown',route:routed.route||'shared_delvin',deterministic:true,shared_delvin:true});
    await save(authorization,cid,'assistant',text(routed.response),{route:routed.route||'shared_delvin',deterministic:true,shared_delvin:true,presentation_version:routed.presentation_version||2,surface_schema:SURFACE_SCHEMA,surface_count:surfaces.length,surfaces,...(async_enrichment?{async_enrichment}:{})});
    await touch(authorization,cid);
    return json({api_schema:API_SCHEMA,client:'web',session_id:cid,conversation_id:cid,response:routed.response,model:null,usage:null,tools:[{name:'ask-collectish-delvin-present-v3',ok:true,classification:'READ'}],surface_schema:SURFACE_SCHEMA,surfaces,presentation:routed.presentation||null,presentation_version:routed.presentation_version||2,async_enrichment,orchestration:{deterministic_route:routed.route||'shared_delvin',shared_delvin_router:true,shared_presentation_contract:true,persisted:true}});
  }catch(e){
    console.warn('shared Delvin persisted facade failed; falling back',String((e as Error)?.message||e));
    return proxyLegacy(authorization,body);
  }
});
