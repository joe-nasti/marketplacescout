import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const FAILED_COOLDOWN_MS=6*60*60*1000;
const DEFAULT_INDEX='https://www.tcgplayer.com/sitemap/index.xml';

async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function safeUrl(v:string){const u=new URL(v);if(u.protocol!=='https:')throw Error('HTTPS required');if(!/(^|\.)tcgplayer\.com$/i.test(u.hostname))throw Error('TCGplayer host required');return u.toString()}
function dec(s:string){return String(s||'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')}
function xmlLocs(xml:string,block='url'){return [...xml.matchAll(new RegExp(`<${block}\\b[^>]*>([\\s\\S]*?)<\\/${block}>`,'gi'))].map(m=>{const b=m[1],loc=(b.match(/<loc>([\s\S]*?)<\/loc>/i)||[])[1]||'',lastmod=(b.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)||[])[1]||'';return{url:dec(loc).trim(),lastmod:lastmod.trim()||null}}).filter(x=>x.url)}
async function getText(url:string,accept='application/xml,text/xml,text/html;q=0.9,*/*;q=0.5'){const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);try{const r=await fetch(safeUrl(url),{redirect:'follow',signal:c.signal,headers:{'User-Agent':'MarketplaceScout/0.5 (+market intelligence sitemap collector)','Accept':accept}});if(!r.ok)throw Error(`TCGplayer HTTP ${r.status}`);return await r.text()}finally{clearTimeout(timer)}}
function recentSort<T extends {lastmod:string|null}>(rows:T[]){return rows.sort((a,b)=>(Date.parse(b.lastmod||'')||0)-(Date.parse(a.lastmod||'')||0))}
function isArticleUrl(url:string){try{const u=new URL(url);return /(^|\.)tcgplayer\.com$/i.test(u.hostname)&&u.pathname.toLowerCase().includes('/content/article/')}catch{return false}}
function articleMeta(html:string,url:string,lastmod:string|null){const title=dec((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'').replace(/\s*\|\s*TCGplayer\s*$/i,'').trim();const author=dec((html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i)||[])[1]||'').trim()||null;const published=(html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|date)["'][^>]+content=["']([^"']+)/i)||[])[1]||lastmod;return{url,title:title||new URL(url).pathname.split('/').filter(Boolean).slice(-2,-1)[0]?.replace(/-/g,' ')||'TCGplayer article',summary:'',published_at:published||null,author}}
function looksMagic(_html:string,item:any){const h=String(item?.title||'').toLowerCase();return /magic[: ]+the gathering|\bmtg\b|\bcommander\b|\bpauper\b|\bmodern\b|\bstandard\b|\bpioneer\b|\blegacy\b|\bvintage\b|\bsecret lair\b/.test(h)}
function subtype(item:any){const h=String(item?.title||'').toLowerCase();if(/best[- ]?selling|bestselling|top[- ]?selling|presales?/.test(h))return'first_party_market_sales';if(/biggest price spikes?|price spikes?|movers and shakers/.test(h))return'first_party_market_price';if(/banned|restricted|banlist|policy|direct|seller|fees?/.test(h))return'marketplace_operations';return'marketplace_editorial'}
function failedRecently(row:any){if(row?.metadata_json?.status!=='failed')return false;const at=Date.parse(String(row?.metadata_json?.last_attempt_at||''));return Number.isFinite(at)&&Date.now()-at<FAILED_COOLDOWN_MS}
async function sha(v:string){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function discoverTcgplayerContent(indexUrl:string,maxCandidates=30){const index=await getText(indexUrl),children=recentSort(xmlLocs(index,'sitemap'));const preferred=children.filter(x=>/content|article/i.test(x.url));const scan=(preferred.length?preferred:children).slice(0,12),found:any[]=[];for(const child of scan){let xml='';try{xml=await getText(child.url)}catch{continue}for(const row of xmlLocs(xml,'url'))if(isArticleUrl(row.url))found.push(row);if(found.length>=maxCandidates)break}const uniq=new Map<string,any>();for(const x of recentSort(found))if(!uniq.has(x.url))uniq.set(x.url,x);return [...uniq.values()].slice(0,maxCandidates)}
async function ingest(t:string,item:any,source:string,sub:string){const r=await fetch(`${U}/functions/v1/market-intel-ingest`,{method:'POST',headers:H(t),body:JSON.stringify({url:item.url,rendered_title:item.title,author:item.author,published_at:item.published_at,source_type:'article',source_name:source,source_profile:'marketplace_editorial',source_subtype:sub})});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`Ingest ${r.status}`);return d}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t)return J({error:'Authentication required'},401);
  let user:any;try{user=await auth(t)}catch{return J({error:'Authentication required'},401)}
  let b:any={};try{b=await req.json()}catch{}
  try{
    const subs=await rest(t,"source_captures?select=source,source_key,payload_json&capture_type=eq.content_subscription&source=eq.TCGplayer%20MTG%20Content&limit=5").catch(()=>[]);
    const sub=subs?.[0];if(!sub&&b?.require_subscription!==false)return J({ok:true,configured:false,attempted:0,saved:0,duplicates:0,failed:0,skipped_saved:0,skipped_failed:0,more_pending:false});
    const source=String(sub?.source||'TCGplayer MTG Content'),indexUrl=safeUrl(String(sub?.source_key||b?.index_url||DEFAULT_INDEX)),maxNew=Math.max(1,Math.min(Number(b?.max_new)||2,4));
    const candidates=await discoverTcgplayerContent(indexUrl,40);let attempted=0,saved=0,duplicates=0,failed=0,skippedSaved=0,skippedFailed=0,morePending=false;
    for(const candidate of candidates){
      const key=candidate.url,existing=await rest(t,`source_captures?select=capture_id,metadata_json&source=eq.${encodeURIComponent(source)}&capture_type=eq.content_item&source_key=eq.${encodeURIComponent(key)}&limit=1`).catch(()=>[]),row=existing?.[0];
      if(row?.metadata_json?.status==='saved'){skippedSaved++;continue}if(failedRecently(row)){skippedFailed++;continue}
      let html='';try{html=await getText(key,'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5')}catch{failed++;continue}
      const item=articleMeta(html,key,candidate.lastmod);if(!looksMagic(html,item))continue;
      if(attempted>=maxNew){morePending=true;break}attempted++;
      const subType=subtype(item);let captureId=row?.capture_id||null;
      if(!captureId){const ins=await rest(t,'source_captures',{method:'POST',prefer:'return=representation',body:{user_id:user.id,source,capture_type:'content_item',source_key:key,content_type:'text/html',payload_json:{title:item.title,published_at:item.published_at,author:item.author,index_url:indexUrl,source_profile:'marketplace_editorial',source_subtype:subType},payload_text:null,content_hash:await sha(`${key}|${item.title}|${item.published_at||''}`),metadata_json:{status:'pending',index_url:indexUrl,source_profile:'marketplace_editorial',source_subtype:subType}}});captureId=(Array.isArray(ins)?ins[0]:ins)?.capture_id||null}
      try{const r=await ingest(t,item,source,subType),s=Number(r?.saved||0),d=Number(r?.duplicates||0);saved+=s;duplicates+=d;if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'saved',index_url:indexUrl,source_profile:'marketplace_editorial',source_subtype:subType,ingested_at:new Date().toISOString(),saved:s,duplicates:d}}})}catch(e){failed++;if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'failed',index_url:indexUrl,source_profile:'marketplace_editorial',source_subtype:subType,last_error:(e as Error).message,last_attempt_at:new Date().toISOString()}}}).catch(()=>null)}
    }
    return J({ok:true,configured:true,discovery:'tcgplayer_content_sitemap',index_url:indexUrl,candidates:candidates.length,attempted,saved,duplicates,failed,skipped_saved:skippedSaved,skipped_failed:skippedFailed,more_pending:morePending});
  }catch(e){return J({error:(e as Error).message},502)}
});
