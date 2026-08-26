import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:t===S&&S?S:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILED_COOLDOWN_MS=6*60*60*1000;
const DEFAULT_BACKFILL_DAYS=21;
const SOURCE='EDHREC Articles';
const INDEX='https://edhrec.com/articles';

async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function dec(s:string){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')}
function text(s:string){return dec(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function safe(v:string,base=INDEX){const u=new URL(v,base);if(u.protocol!=='https:'||!/(^|\.)edhrec\.com$/i.test(u.hostname))throw Error('Unsupported EDHREC URL');u.hash='';return u.toString()}
async function getText(url:string){const c=new AbortController(),timer=setTimeout(()=>c.abort(),20000);try{const r=await fetch(safe(url),{redirect:'follow',signal:c.signal,headers:{'User-Agent':'MarketplaceScout/0.6 (+EDHREC public article collector)','Accept':'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'}});if(!r.ok)throw Error(`EDHREC HTTP ${r.status}`);return await r.text()}finally{clearTimeout(timer)}}
function meta(html:string,name:string){const e=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const a=html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${e}["'][^>]+content=["']([^"']+)`,'i'));const b=html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${e}["']`,'i'));return dec((a||b||[])[1]||'').trim()}
function links(html:string){const out:string[]=[];for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)){let u='';try{u=safe(dec(m[1]))}catch{continue}const p=new URL(u).pathname.replace(/\/$/,'');if(!/^\/articles\/[a-z0-9][a-z0-9-]+$/i.test(p))continue;if(/\/articles\/(?:for-writers|guides?|tags?|authors?)$/i.test(p))continue;if(!out.includes(u))out.push(u)}return out}
function article(html:string,url:string){const title=(meta(html,'og:title')||text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'')).replace(/\s*[|–-]\s*EDHREC.*$/i,'').trim();const published=meta(html,'article:published_time')||meta(html,'datePublished')||dec((html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)||[])[1]||'')||dec((html.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)||[])[1]||'')||null;const author=meta(html,'author')||dec((html.match(/["']author["']\s*:\s*\{[^}]*["']name["']\s*:\s*["']([^"']+)/i)||[])[1]||'')||null;const body=(html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)||html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)||[])[1]||html;return{url,title,author,published_at:published,rendered_text:text(body).slice(0,70000)}}
function subtype(title:string){const h=String(title||'').toLowerCase();if(/price|finance|buy|sell|spec|market|expensive|budget/.test(h))return'edhrec_finance';if(/top\s*\d+|most played|ranking|ranked|best\b/.test(h))return'edhrec_rankings';if(/news|announces?|banned|ban\b|release|secret lair|spoiler|preview/.test(h))return'edhrec_news';if(/deck|commander|upgrade|brew|build|cuts?|makeover/.test(h))return'edhrec_deckbuilding';return'commander_editorial'}
function failedRecently(row:any){if(row?.metadata_json?.status!=='failed')return false;const at=Date.parse(String(row?.metadata_json?.last_attempt_at||''));return Number.isFinite(at)&&Date.now()-at<FAILED_COOLDOWN_MS}
async function sha(v:string){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function ingest(t:string,item:any,owner:string,scheduler:boolean){const st=subtype(item.title);const body:any={url:item.url,rendered_title:item.title,rendered_text:item.rendered_text,author:item.author,published_at:item.published_at,source_type:'article',source_name:SOURCE,source_profile:'commander_editorial',source_subtype:st};if(scheduler)body._scheduler_user_id=owner;const r=await fetch(`${U}/functions/v1/market-intel-ingest`,{method:'POST',headers:H(t),body:JSON.stringify(body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`Ingest ${r.status}`);return{...d,source_subtype:st}}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const caller=bearer(req);if(!caller)return J({error:'Authentication required'},401);
  let b:any={};try{b=await req.json()}catch{}
  const scheduler=await serviceAuth(caller);let user:any=null;
  if(!scheduler){try{user=await auth(caller)}catch{return J({error:'Authentication required'},401)}}
  if(scheduler&&!S)return J({error:'Service role unavailable'},500);
  const t=scheduler?S:caller;
  try{
    const select=scheduler?'capture_id,user_id,source,source_key,payload_json':'capture_id,source,source_key,payload_json';
    const rows=await rest(t,`source_captures?select=${select}&capture_type=eq.content_subscription&payload_json->>discovery=eq.edhrec_articles&order=captured_at.asc&limit=20`).catch(()=>[]);
    const subs=(rows||[]).filter((x:any)=>x?.payload_json?.enabled!==false&&x?.source_key);
    const maxNew=Math.max(1,Math.min(Number(b?.max_new)||2,scheduler?6:3));
    let attempted=0,saved=0,duplicates=0,failed=0,skippedSaved=0,skippedFailed=0,scanned=0,morePending=false;
    const report:any[]=[];
    for(const sub of subs){
      const owner=scheduler?String(sub.user_id||''):String(user.id||'');if(!UUID.test(owner))continue;
      const days=Math.max(1,Math.min(Number(sub?.payload_json?.backfill_days)||DEFAULT_BACKFILL_DAYS,60));
      const cutoff=Date.now()-days*86400000;
      const backfillComplete=!!sub?.payload_json?.backfill_complete;
      const maxPages=backfillComplete?2:12;
      const existingRows=await rest(t,`source_captures?select=capture_id,source_key,metadata_json&user_id=eq.${encodeURIComponent(owner)}&source=eq.${encodeURIComponent(SOURCE)}&capture_type=eq.content_item&order=captured_at.desc&limit=1000`).catch(()=>[]);
      const existing=new Map((existingRows||[]).map((x:any)=>[String(x.source_key||''),x]));
      const out:any={source:SOURCE,backfill_days:days,backfill_complete:backfillComplete,pages:0,scanned:0,attempted:0,saved:0,duplicates:0,failed:0,errors:[]};
      let reachedCutoff=false,stop=false;
      for(let page=1;page<=maxPages&&!stop;page++){
        const pageUrl=page===1?INDEX:`${INDEX}?page=${page}`;let html='';try{html=await getText(pageUrl)}catch(e){failed++;out.failed++;out.errors.push((e as Error).message);break}
        out.pages++;
        const urls=links(html);if(!urls.length)break;
        for(const url of urls){
          out.scanned++;scanned++;
          const row=existing.get(url);
          if(row?.metadata_json?.status==='saved'){skippedSaved++;continue}
          if(failedRecently(row)){skippedFailed++;continue}
          if(attempted>=maxNew){morePending=true;stop=true;break}
          let articleHtml='';try{articleHtml=await getText(url)}catch(e){failed++;out.failed++;out.errors.push(`${url}: ${(e as Error).message}`);continue}
          const item=article(articleHtml,url);const publishedMs=Date.parse(String(item.published_at||''));
          if(Number.isFinite(publishedMs)&&publishedMs<cutoff){reachedCutoff=true;stop=true;break}
          if(!item.title||item.rendered_text.length<250)continue;
          attempted++;out.attempted++;
          const st=subtype(item.title);let captureId=row?.capture_id||null;
          if(!captureId){const ins=await rest(t,'source_captures',{method:'POST',prefer:'return=representation',body:{user_id:owner,source:SOURCE,capture_type:'content_item',source_key:url,content_type:'text/html',payload_json:{title:item.title,published_at:item.published_at,author:item.author,index_url:INDEX,source_profile:'commander_editorial',source_subtype:st},content_hash:await sha(`${url}|${item.title}|${item.published_at||''}`),metadata_json:{status:'pending',index_url:INDEX,source_profile:'commander_editorial',source_subtype:st}}});captureId=(Array.isArray(ins)?ins[0]:ins)?.capture_id||null}
          try{const r=await ingest(t,item,owner,scheduler),s=Number(r?.saved||0),d=Number(r?.duplicates||0);saved+=s;duplicates+=d;out.saved+=s;out.duplicates+=d;if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'saved',index_url:INDEX,source_profile:'commander_editorial',source_subtype:st,ingested_at:new Date().toISOString(),saved:s,duplicates:d}}});existing.set(url,{capture_id:captureId,metadata_json:{status:'saved'}})}catch(e){failed++;out.failed++;out.errors.push(`${item.title}: ${(e as Error).message}`);if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'failed',index_url:INDEX,source_profile:'commander_editorial',source_subtype:st,last_error:(e as Error).message,last_attempt_at:new Date().toISOString()}}}).catch(()=>null)}
        }
      }
      if(reachedCutoff&&!morePending&&!backfillComplete&&sub.capture_id){const payload={...(sub.payload_json||{}),backfill_complete:true,backfill_completed_at:new Date().toISOString()};await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(sub.capture_id)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',prefer:'return=minimal',body:{payload_json:payload}}).catch(()=>null);out.backfill_complete=true}
      report.push(out);
      if(attempted>=maxNew)break;
    }
    return J({ok:true,mode:scheduler?'scheduled':'user',configured:subs.length,scanned,attempted,saved,duplicates,failed,skipped_saved:skippedSaved,skipped_failed:skippedFailed,more_pending:morePending,report});
  }catch(e){return J({error:(e as Error).message},502)}
});
