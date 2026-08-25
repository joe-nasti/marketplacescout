import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const FAILED_COOLDOWN_MS=6*60*60*1000;
const ALLOWED=new Set(['www.cardmarket.com','cardmarket.com','www.coolstuffinc.com','coolstuffinc.com','magic.wizards.com']);

async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function safeUrl(v:string,base?:string){const u=new URL(v,base);if(u.protocol!=='https:'||!ALLOWED.has(u.hostname.toLowerCase()))throw Error('Unsupported curated source host');u.hash='';return u.toString()}
function dec(s:string){return String(s||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')}
function text(s:string){return dec(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
async function getText(url:string){const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);try{const r=await fetch(safeUrl(url),{redirect:'follow',signal:c.signal,headers:{'User-Agent':'MarketplaceScout/0.5 (+market intelligence public article collector)','Accept':'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'}});if(!r.ok)throw Error(`Source HTTP ${r.status}`);return await r.text()}finally{clearTimeout(timer)}}
function meta(html:string,name:string){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const a=html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)`,'i'));const b=html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,'i'));return dec((a||b||[])[1]||'').trim()}
function articleMeta(html:string,url:string){const title=meta(html,'og:title')||text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'');const author=meta(html,'author')||null;const published=meta(html,'article:published_time')||meta(html,'date')||null;return{url,title:title.replace(/\s*[|–-]\s*(Cardmarket|CoolStuffInc(?:\.com)?|Magic: The Gathering|Wizards of the Coast).*$/i,'').trim(),author,published_at:published}}
function hrefs(html:string,base:string){const out:string[]=[];for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)){try{const u=safeUrl(dec(m[1]),base);if(!out.includes(u))out.push(u)}catch{}}return out}
function adapter(source:string,url:string){const h=new URL(url).hostname.toLowerCase();if(h.includes('cardmarket.com'))return'cardmarket';if(h.includes('coolstuffinc.com'))return'coolstuffinc';if(h==='magic.wizards.com')return'wizards';const s=source.toLowerCase();if(s.includes('cardmarket'))return'cardmarket';if(s.includes('coolstuff'))return'coolstuffinc';if(s.includes('wizards'))return'wizards';return'unknown'}
function isArticle(kind:string,url:string){const p=new URL(url).pathname;if(kind==='cardmarket')return /^\/en\/Insight\/Articles\/[a-z0-9-]+\/?$/i.test(p);if(kind==='coolstuffinc')return /^\/a\/[a-z0-9][a-z0-9-]+-\d{8}\/?$/i.test(p);if(kind==='wizards')return /^\/en\/news\/[^/]+\/[^/]+\/?$/i.test(p)&&!p.endsWith('/archive');return false}
function subtype(profile:string,title:string){const h=title.toLowerCase();if(profile==='official_primary'){if(/banned|restricted|ban list|banlist/.test(h))return'official_rules';if(/release|available now|product|secret lair|preview|card image gallery|collecting/.test(h))return'official_product';if(/update bulletin|rules update/.test(h))return'official_rules';return'official_news'}if(profile==='marketplace_editorial'){if(/what.?s new at cardmarket|fee|policy|powerseller|inventory|shipping|payment|marketplace/.test(h))return'marketplace_operations';return'marketplace_editorial'}if(profile==='retailer_editorial'){if(/best[- ]?selling|top[- ]?selling|most sold/.test(h))return'first_party_sales';if(/reprint|reprinted/.test(h))return'retailer_reprint_editorial';return'retailer_opinion'}return profile||'generic_editorial'}
function failedRecently(row:any){if(row?.metadata_json?.status!=='failed')return false;const at=Date.parse(String(row?.metadata_json?.last_attempt_at||''));return Number.isFinite(at)&&Date.now()-at<FAILED_COOLDOWN_MS}
async function sha(v:string){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function ingest(t:string,item:any,source:string,profile:string,sub:string){const r=await fetch(`${U}/functions/v1/market-intel-ingest`,{method:'POST',headers:H(t),body:JSON.stringify({url:item.url,rendered_title:item.title,author:item.author,published_at:item.published_at,source_type:profile==='official_primary'?'official':'article',source_name:source,source_profile:profile,source_subtype:sub})});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`Ingest ${r.status}`);return d}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t)return J({error:'Authentication required'},401);
  let user:any;try{user=await auth(t)}catch{return J({error:'Authentication required'},401)}
  let b:any={};try{b=await req.json()}catch{}
  try{
    const rows=await rest(t,"source_captures?select=source,source_key,payload_json&capture_type=eq.content_subscription&payload_json->>discovery=eq.curated_page&order=captured_at.asc&limit=20").catch(()=>[]);
    const subs=(rows||[]).filter((x:any)=>x?.payload_json?.enabled!==false&&x?.source_key);
    const maxNew=Math.max(1,Math.min(Number(b?.max_new)||2,4));let attempted=0,saved=0,duplicates=0,failed=0,skippedSaved=0,skippedFailed=0,morePending=false;const report:any[]=[];
    for(const sub of subs){
      const source=String(sub.source||'Curated source'),indexUrl=safeUrl(String(sub.source_key)),profile=String(sub?.payload_json?.source_profile||'generic_editorial'),kind=adapter(source,indexUrl),maxItems=Math.max(1,Math.min(Number(sub?.payload_json?.max_items)||5,12));const out:any={source,scanned:0,attempted:0,saved:0,duplicates:0,failed:0,errors:[]};
      if(kind==='unknown'){out.failed++;failed++;out.errors.push('Unsupported curated source adapter');report.push(out);continue}
      let listing='';try{listing=await getText(indexUrl)}catch(e){out.failed++;failed++;out.errors.push((e as Error).message);report.push(out);continue}
      const candidates=hrefs(listing,indexUrl).filter(u=>isArticle(kind,u)).slice(0,maxItems);
      for(const url of candidates){
        out.scanned++;
        const existing=await rest(t,`source_captures?select=capture_id,metadata_json&source=eq.${encodeURIComponent(source)}&capture_type=eq.content_item&source_key=eq.${encodeURIComponent(url)}&limit=1`).catch(()=>[]),row=existing?.[0];
        if(row?.metadata_json?.status==='saved'){skippedSaved++;continue}if(failedRecently(row)){skippedFailed++;continue}
        if(attempted>=maxNew){morePending=true;break}
        let html='';try{html=await getText(url)}catch(e){failed++;out.failed++;out.errors.push((e as Error).message);continue}
        const item=articleMeta(html,url);if(!item.title||text(html).length<200)continue;
        attempted++;out.attempted++;const subType=subtype(profile,item.title);let captureId=row?.capture_id||null;
        if(!captureId){const ins=await rest(t,'source_captures',{method:'POST',prefer:'return=representation',body:{user_id:user.id,source,capture_type:'content_item',source_key:url,content_type:'text/html',payload_json:{title:item.title,published_at:item.published_at,author:item.author,index_url:indexUrl,source_profile:profile,source_subtype:subType},content_hash:await sha(`${url}|${item.title}|${item.published_at||''}`),metadata_json:{status:'pending',index_url:indexUrl,source_profile:profile,source_subtype:subType}}});captureId=(Array.isArray(ins)?ins[0]:ins)?.capture_id||null}
        try{const r=await ingest(t,item,source,profile,subType),s=Number(r?.saved||0),d=Number(r?.duplicates||0);saved+=s;duplicates+=d;out.saved+=s;out.duplicates+=d;if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'saved',index_url:indexUrl,source_profile:profile,source_subtype:subType,ingested_at:new Date().toISOString(),saved:s,duplicates:d}}})}catch(e){failed++;out.failed++;out.errors.push(`${item.title}: ${(e as Error).message}`);if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'failed',index_url:indexUrl,source_profile:profile,source_subtype:subType,last_error:(e as Error).message,last_attempt_at:new Date().toISOString()}}}).catch(()=>null)}
      }
      report.push(out);if(attempted>=maxNew)break;
    }
    return J({ok:true,configured:subs.length,attempted,saved,duplicates,failed,skipped_saved:skippedSaved,skipped_failed:skippedFailed,more_pending:morePending,report});
  }catch(e){return J({error:(e as Error).message},502)}
});
