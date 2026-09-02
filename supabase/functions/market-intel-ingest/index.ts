import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:t===S&&S?S:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const allowedSource=new Set(['article','x','discord','reddit','youtube','official','manual','other']);
const trim=(x:any,n=500)=>String(x??'').trim().slice(0,n);
const clamp=(n:any)=>Number.isFinite(Number(n))?Math.max(0,Math.min(1,Number(n))):0.5;
const normText=(x:any,n=1200)=>trim(x,n).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const canonical=(s:any)=>`${normText(s?.claim_type,40)}|${normText(s?.direction,20)}|${normText(s?.entity_name,300)}|${normText(s?.summary,900)}`;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function youtubeId(value:string){try{const u=new URL(value),h=u.hostname.toLowerCase().replace(/^www\./,'');if(h==='youtu.be')return u.pathname.split('/').filter(Boolean)[0]||'';if(h==='youtube.com'||h.endsWith('.youtube.com'))return u.searchParams.get('v')||u.pathname.match(/\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1]||''}catch{}return''}
function canonicalSourceUrl(value:string){const raw=trim(value,2000);if(!raw)return'';const vid=youtubeId(raw);if(vid)return `https://youtube.com/watch?v=${encodeURIComponent(vid)}`;try{const u=new URL(raw);u.hash='';u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');for(const key of [...u.searchParams.keys()]){const k=key.toLowerCase();if(k.startsWith('utm_')||['t','time_continue','start','si','feature','pp','ab_channel','fbclid','gclid','mc_cid','mc_eid'].includes(k))u.searchParams.delete(key)}u.searchParams.sort();if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');return u.toString()}catch{return raw}}
function sourceIdentity(value:string){const vid=youtubeId(value);return vid?`youtube:${vid}`:`url:${canonicalSourceUrl(value)}`}
function sourceType(url:string,requested:any){const r=trim(requested,30).toLowerCase();if(allowedSource.has(r))return r;try{const h=new URL(url).hostname.toLowerCase();if(h==='x.com'||h==='twitter.com')return'x';if(h.includes('discord.com'))return'discord';if(h.includes('reddit.com'))return'reddit';if(h.includes('youtube.com')||h==='youtu.be')return'youtube';return'article'}catch{return'other'}}
function sourceName(url:string,requested:any){const r=trim(requested,120);if(r)return r;try{const h=new URL(url).hostname.replace(/^www\./,'');if(h==='x.com'||h==='twitter.com')return'X';if(h==='discord.com')return'Discord';return h}catch{return'Unknown'}}
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const text=await r.text();let d:any;try{d=text?JSON.parse(text):null}catch{d=text}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function rpc(t:string,name:string,args:any={}){return rest(t,`rpc/${name}`,{method:'POST',body:args})}
async function analyze(t:string,b:any){const r=await fetch(`${U}/functions/v1/market-intel-analyze`,{method:'POST',headers:H(t),body:JSON.stringify({url:b.url,rendered_text:b.rendered_text,rendered_title:b.rendered_title,published_at:b.published_at,author:b.author,source_profile:b.source_profile,source_subtype:b.source_subtype})});const text=await r.text();let d:any;try{d=text?JSON.parse(text):{}}catch{d={error:text}}if(!r.ok)throw Error(d?.error||`Analyzer ${r.status}`);return d}

function normName(value:string){return String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function editDistance(a:string,b:string){const x=normName(a),y=normName(b);if(x===y)return 0;if(!x.length)return y.length;if(!y.length)return x.length;let prev=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const cur=[i];for(let j=1;j<=y.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev=cur}return prev[y.length]}
function acceptableFuzzy(input:string,resolved:string){const a=normName(input),b=normName(resolved);if(!a||!b)return false;if(a===b)return true;const max=Math.max(a.length,b.length);const d=editDistance(a,b);return d<=2||d/max<=0.16}
async function scryfallNamed(name:string,mode:'exact'|'fuzzy'){try{const r=await fetch(`https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(name)}`,{headers:{'User-Agent':'MarketplaceScout/0.4 (+market intelligence entity resolver)'}});if(!r.ok)return null;const c=await r.json();return c?.id?{name:String(c.name||name),scryfall_id:String(c.id),set_code:c.set?String(c.set):null}:null}catch{return null}}
async function resolveCard(name:string){const exact=await scryfallNamed(name,'exact');if(exact)return exact;const fuzzy=await scryfallNamed(name,'fuzzy');return fuzzy&&acceptableFuzzy(name,fuzzy.name)?fuzzy:null}
async function normalizeEntity(s:any){const requested=trim(s?.entity_type,40)||'other',name=trim(s?.entity_name,300);if(requested!=='card')return{entity_type:requested,entity_name:name,scryfall_id:s?.scryfall_id||null,set_code:trim(s?.set_code,20)||null,confidence:clamp(s?.confidence),card_resolution:'not_applicable'};const resolved=await resolveCard(name);if(resolved)return{entity_type:'card',entity_name:resolved.name,scryfall_id:resolved.scryfall_id,set_code:resolved.set_code,confidence:0.99,card_resolution:normName(name)===normName(resolved.name)?'exact':'fuzzy'};return{entity_type:'other',entity_name:name,scryfall_id:null,set_code:null,confidence:Math.min(clamp(s?.confidence),0.5),card_resolution:'rejected'} }

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const caller=bearer(req);if(!caller)return J({error:'Authentication required'},401);
  let b:any;try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
  const scheduler=await serviceAuth(caller);let owner='';
  if(scheduler){owner=trim(b?._scheduler_user_id,80);if(!UUID.test(owner))return J({error:'Scheduled ingestion requires a persisted owner id'},400)}
  else{let user:any;try{user=await auth(caller)}catch{return J({error:'Authentication required'},401)}owner=String(user.id||'')}
  if(!UUID.test(owner))return J({error:'Unable to resolve source owner'},400);
  const t=scheduler?S:caller;if(scheduler&&!S)return J({error:'Service role unavailable'},500);
  const rawUrl=trim(b?.url||b?.analysis?.url,2000);if(!/^https?:\/\//i.test(rawUrl))return J({error:'A public http/https source URL is required'},400);
  const url=canonicalSourceUrl(rawUrl),identity=sourceIdentity(rawUrl),st=sourceType(url,b.source_type);
  try{
    const analysis=b?.analysis&&Array.isArray(b.analysis.signals)?b.analysis:await analyze(t,{...b,url:rawUrl});
    const all=Array.isArray(analysis?.signals)?analysis.signals.slice(0,20):[];
    const selected=Array.isArray(b?.selected_indexes)?b.selected_indexes.map(Number).filter((n:number)=>Number.isInteger(n)&&n>=0&&n<all.length).map((n:number)=>all[n]):all.filter((s:any)=>s?.signal_stage!=='noise');
    if(!selected.length)return J({ok:true,url,original_url:rawUrl,source_identity:identity,analysis,saved:0,duplicates:0,intel_ids:[],rejected_cards:0});

    const candidates=await rest(t,`market_intel_items?select=intel_id,source_url,claim_type,direction,summary,confidence,published_at,market_intel_entities(entity_name)&user_id=eq.${encodeURIComponent(owner)}&source_type=eq.${encodeURIComponent(st)}&order=observed_at.desc&limit=1000`).catch(()=>[]);
    const existing=(candidates||[]).filter((x:any)=>sourceIdentity(String(x.source_url||''))===identity);
    const seen=new Map((existing||[]).map((x:any)=>[canonical({claim_type:x.claim_type,direction:x.direction,entity_name:x.market_intel_entities?.[0]?.entity_name,summary:x.summary}),x]));
    const ids:string[]=[];let duplicates=0,rejectedCards=0,fuzzyCards=0,updated=0;
    for(const s of selected){
      const entity=await normalizeEntity(s);if(entity.card_resolution==='rejected')rejectedCards++;if(entity.card_resolution==='fuzzy')fuzzyCards++;
      const normalized={...s,entity_name:entity.entity_name,entity_type:entity.entity_type},fingerprint=canonical(normalized),hit=seen.get(fingerprint);
      if(hit){
        duplicates++;
        const patch:any={source_url:url,confidence:Math.max(Number(hit.confidence||0),clamp(s?.confidence))};
        if(!hit.published_at&&(analysis?.published_at||b?.published_at))patch.published_at=analysis?.published_at||b?.published_at;
        await rest(t,`market_intel_items?intel_id=eq.${encodeURIComponent(hit.intel_id)}`,{method:'PATCH',prefer:'return=minimal',body:patch}).catch(()=>null);
        updated++;
        continue;
      }
      const inserted=await rest(t,'market_intel_items',{method:'POST',prefer:'return=representation',body:{user_id:owner,source_type:st,source_name:sourceName(url,b.source_name),source_url:url,title:trim(analysis?.title||entity.entity_name,500)||null,author:trim(analysis?.author||b?.author,250)||null,summary:trim(s?.summary,1200)||null,claim_type:trim(s?.claim_type,40)||'other',direction:trim(s?.direction,20)||'neutral',signal_stage:trim(s?.signal_stage,30)||'unclassified',confidence:clamp(s?.confidence),published_at:analysis?.published_at||b?.published_at||null}});
      const item=Array.isArray(inserted)?inserted[0]:inserted;if(!item?.intel_id)continue;
      await rest(t,'market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:item.intel_id,user_id:owner,entity_type:entity.entity_type,entity_name:entity.entity_name,scryfall_id:entity.scryfall_id,set_code:entity.set_code,confidence:entity.confidence}});
      ids.push(item.intel_id);seen.set(fingerprint,item);
    }
    if(ids.length||updated){await rpc(t,'refresh_market_intel_entity_links',{}).catch(()=>null);await rpc(t,'refresh_market_intel_evaluations',{}).catch(()=>null)}
    return J({ok:true,url,original_url:rawUrl,source_identity:identity,analysis,saved:ids.length,duplicates,updated,intel_ids:ids,rejected_cards:rejectedCards,fuzzy_cards:fuzzyCards,source_type:st,source_name:sourceName(url,b.source_name),source_profile:trim(b.source_profile,60)||null,source_subtype:trim(b.source_subtype,60)||null,mode:scheduler?'scheduled':'user'});
  }catch(e){return J({error:(e as Error).message},502)}
});
