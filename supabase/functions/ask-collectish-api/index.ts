import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const API_SCHEMA='collectish.ask.api.v1';
const enc=new TextEncoder(),dec=new TextDecoder();
const text=(v:any)=>String(v??'').trim();
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const userHeaders=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const svcHeaders=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});

async function parse(r:Response){const raw=await r.text();try{return raw?JSON.parse(raw):null}catch{return raw}}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...userHeaders(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const d=await parse(r);if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function svc(path:string,opt:any={}){if(!S)throw Error('Service role unavailable');const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...svcHeaders(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const d=await parse(r);if(!r.ok)throw Error(d?.message||`Service REST ${r.status}`);return d}
async function call(t:string,name:string,body:any){try{const r=await fetch(`${U}/functions/v1/${name}`,{method:'POST',headers:userHeaders(t),body:JSON.stringify(body)});const d=await parse(r);if(!r.ok)return{ok:false,error:d?.error||`${name} HTTP ${r.status}`,status:r.status};return d}catch(e){return{ok:false,error:String((e as Error)?.message||e)}}}

function b64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)}
function unb64(v:string){const s=atob(String(v||'')),o=new Uint8Array(s.length);for(let i=0;i<s.length;i++)o[i]=s.charCodeAt(i);return o}
async function guestKey(){const raw=await crypto.subtle.digest('SHA-256',enc.encode(`collectish-discord-guest-v1:${S}`));return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])}
async function encrypt(v:string){const iv=crypto.getRandomValues(new Uint8Array(12)),buf=await crypto.subtle.encrypt({name:'AES-GCM',iv},await guestKey(),enc.encode(v));return{ciphertext:b64(new Uint8Array(buf)),iv:b64(iv)}}
async function decrypt(ciphertext:string,iv:string){const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await guestKey(),unb64(ciphertext));return dec.decode(buf)}
async function authRequest(path:string,body:any){const r=await fetch(`${U}/auth/v1/${path}`,{method:'POST',headers:{apikey:A,Authorization:`Bearer ${A}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await parse(r)||{};if(!r.ok)throw Error(d?.msg||d?.message||d?.error_description||d?.error||`Auth ${r.status}`);return d}
async function guestDiscordId(body:any){const direct=text(body?.context?.discord?.discord_user_id);if(direct)return direct;const iid=text(body?.context?.discord?.interaction_id);if(!iid)throw Error('Discord guest identity is missing');const rows=await svc(`discord_ask_deliveries?interaction_id=eq.${encodeURIComponent(iid)}&select=discord_user_id&limit=1`);const id=text(rows?.[0]?.discord_user_id);if(!id)throw Error('Discord guest identity could not be resolved');return id}
async function saveGuest(discordId:string,userId:string|null,refresh:string){const e=await encrypt(refresh);await svc('discord_guest_auth_sessions?on_conflict=discord_user_id',{method:'POST',prefer:'resolution=merge-duplicates',body:[{discord_user_id:discordId,anonymous_user_id:userId,refresh_token_ciphertext:e.ciphertext,refresh_token_iv:e.iv,updated_at:new Date().toISOString()}]})}
async function guestToken(body:any){const id=await guestDiscordId(body),rows=await svc(`discord_guest_auth_sessions?discord_user_id=eq.${encodeURIComponent(id)}&select=discord_user_id,anonymous_user_id,refresh_token_ciphertext,refresh_token_iv&limit=1`),row=rows?.[0];if(row){try{const refresh=await decrypt(row.refresh_token_ciphertext,row.refresh_token_iv),d=await authRequest('token?grant_type=refresh_token',{refresh_token:refresh});if(d?.refresh_token)await saveGuest(id,d?.user?.id||row.anonymous_user_id||null,d.refresh_token);if(d?.access_token)return d.access_token}catch{await svc(`discord_guest_auth_sessions?discord_user_id=eq.${encodeURIComponent(id)}`,{method:'DELETE'}).catch(()=>null)}}const d=await authRequest('signup',{data:{source:'discord_guest'}});if(!d?.access_token||!d?.refresh_token)throw Error('Anonymous sign-in did not return a session');await saveGuest(id,d?.user?.id||null,d.refresh_token);return d.access_token}

const sessionView=(r:any)=>r?{id:r.id,title:r.title??null,updated_at:r.updated_at??null,created_at:r.created_at??null}:null;
async function createSession(t:string,body:any){const title=text(body?.title||body?.message||'New conversation').slice(0,90)||'New conversation',rows=await rest(t,'ask_collectish_conversations',{method:'POST',prefer:'return=representation',body:[{title}]});const session=sessionView(rows?.[0]);if(!session?.id)throw Error('Ask session was not created');return{api_schema:API_SCHEMA,session}}
async function listSessions(t:string,body:any){const n=Math.max(1,Math.min(Number(body?.limit||30)||30,100)),rows=await rest(t,`ask_collectish_conversations?select=id,title,updated_at,created_at&order=updated_at.desc&limit=${n}`);return{api_schema:API_SCHEMA,sessions:(rows||[]).map(sessionView)}}
async function getSession(t:string,body:any){const id=text(body?.session_id||body?.conversation_id);if(!id)return{error:'session_id required',status:400};const rows=await rest(t,`ask_collectish_conversations?id=eq.${encodeURIComponent(id)}&select=id,title,updated_at,created_at&limit=1`),session=sessionView(rows?.[0]);if(!session)return{error:'Ask session not found',status:404};const messages=await rest(t,`ask_collectish_messages?select=id,role,content,metadata,created_at&conversation_id=eq.${encodeURIComponent(id)}&order=created_at.asc&limit=250`);return{api_schema:API_SCHEMA,session,messages:messages||[]}}
async function ensureSession(t:string,id:any,title:string){const s=text(id);if(s){const rows=await rest(t,`ask_collectish_conversations?id=eq.${encodeURIComponent(s)}&select=id&limit=1`).catch(()=>[]);if(rows?.[0]?.id)return String(rows[0].id)}const made=await createSession(t,{title});return String(made.session.id)}
async function saveMessage(t:string,cid:string,role:string,content:string,metadata:any={}){if(!cid||!content)return;await rest(t,'ask_collectish_messages',{method:'POST',prefer:'return=minimal',body:[{conversation_id:cid,role,content,metadata}]}).catch(()=>null)}
async function touch(t:string,id:any){const s=text(id);if(s)await rest(t,`ask_collectish_conversations?id=eq.${encodeURIComponent(s)}`,{method:'PATCH',body:{updated_at:new Date().toISOString()}}).catch(()=>null)}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return json({api_schema:API_SCHEMA,error:'POST required'},405);
  const requestToken=bearer(req);if(!requestToken)return json({api_schema:API_SCHEMA,error:'Authentication required'},401);
  let body:any;try{body=await req.json()}catch{return json({api_schema:API_SCHEMA,error:'Invalid JSON'},400)}
  const guest=body?.guest===true&&text(body?.client).toLowerCase()==='discord_guest',action=text(body?.action||'chat').toLowerCase();
  try{
    const t=guest?await guestToken(body):requestToken;
    if(action==='session.create')return json(await createSession(t,body));
    if(action==='session.list')return json(await listSessions(t,body));
    if(action==='session.get'){const x:any=await getSession(t,body);return x?.error?json({api_schema:API_SCHEMA,error:x.error},x.status||400):json(x)}

    const ob={...body,...(body?.conversation_id?{}:body?.session_id?{conversation_id:body.session_id}:{})};
    const identity=action==='chat'?await call(t,'ask-collectish-identity-recovery',ob):null;
    const routed=action==='chat'?await call(t,'ask-collectish-route-intents',ob):null;
    if(routed?.handled){
      const q=text(ob.message||ob.question),cid=await ensureSession(t,ob.conversation_id,q||'Ask Collectish');
      await saveMessage(t,cid,'user',q,{screen:ob?.context?.screen||'unknown',route:routed.route||'shared_deterministic',deterministic:true});
      await saveMessage(t,cid,'assistant',text(routed.response),{route:routed.route||'shared_deterministic',deterministic:true,surface_schema:'collectish.ask.surface.v10',surface_count:Array.isArray(routed.surfaces)?routed.surfaces.length:0});
      await touch(t,cid);
      return json({api_schema:API_SCHEMA,client:text(body?.client||'web')||'web',guest,session_id:cid,conversation_id:cid,response:routed.response||'',model:null,usage:null,tools:routed.tools||[],surface_schema:'collectish.ask.surface.v10',surfaces:routed.surfaces||[],orchestration:{deterministic_route:routed.route||'shared',shared_router:true},identity_recovery:identity});
    }

    const r:any=await call(t,'ask-collectish-orchestrator',ob);if(r?.ok===false)return json({api_schema:API_SCHEMA,error:r.error||'Ask orchestration failed',identity_recovery:identity},r.status||500);
    const cid=r?.conversation_id||ob.conversation_id||null;await touch(t,cid);
    return json({api_schema:API_SCHEMA,client:text(body?.client||'web')||'web',guest,session_id:cid,...r,identity_recovery:identity});
  }catch(e){const message=String((e as Error)?.message||e||'Ask API request failed');return json({api_schema:API_SCHEMA,error:message,...(guest?{guest_setup_required:/anonymous sign|provider.*disabled/i.test(message)}:{})},500)}
});
