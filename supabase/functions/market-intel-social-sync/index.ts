import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=(t:string)=>({apikey:t===S&&S?S:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const trim=(x:any,n=2000)=>String(x??'').trim().slice(0,n);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILED_COOLDOWN_MS=3*60*60*1000;

async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function safeUrl(value:string,base?:string){const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol))throw Error('Only public http/https sources are supported');const h=u.hostname.toLowerCase();if(h==='localhost'||h==='127.0.0.1'||h==='::1'||h.endsWith('.local'))throw Error('Private hosts are not supported');return u.toString()}
function dec(s:string){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')}
function text(s:string){return dec(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function tag(block:string,name:string){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?dec(m[1]).trim():''}
function attr(block:string,name:string,a:string){const m=block.match(new RegExp(`<${name}\\b[^>]*\\s${a}=[\"']([^\"']+)[\"'][^>]*>`,'i'));return m?dec(m[1]).trim():''}
async function fetchXml(url:string){const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);try{const r=await fetch(safeUrl(url),{redirect:'follow',signal:c.signal,headers:{'User-Agent':'CollectishSignals/1.0 (+read-only community signals)','Accept':'application/atom+xml,application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.4'}});if(!r.ok)throw Error(`Source HTTP ${r.status}`);return await r.text()}finally{clearTimeout(timer)}}
function parseFeed(xml:string,feedUrl:string){const atom=[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(m=>m[1]);const rss=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);const blocks=atom.length?atom:rss;return blocks.map((b,i)=>{const rawLink=attr(b,'link','href')||tag(b,'link')||tag(b,'guid');let url='';try{url=safeUrl(rawLink,feedUrl)}catch{}const title=text(tag(b,'title'))||`Social post ${i+1}`;const summary=text(tag(b,'content')||tag(b,'content:encoded')||tag(b,'summary')||tag(b,'description')).slice(0,10000);const published=tag(b,'published')||tag(b,'updated')||tag(b,'pubDate')||null;const author=text(tag(tag(b,'author'),'name')||tag(b,'dc:creator')||tag(b,'author'))||null;return{url,title,summary,published_at:published,author}}).filter(x=>x.url)}
function failedRecently(row:any){if(row?.metadata_json?.status!=='failed')return false;const at=Date.parse(String(row?.metadata_json?.last_attempt_at||''));return Number.isFinite(at)&&Date.now()-at<FAILED_COOLDOWN_MS}
async function sha(v:string){const bytes=new TextEncoder().encode(v),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function sourceType(adapter:string){if(adapter==='reddit_rss')return'reddit';if(adapter==='x_api')return'x';if(adapter==='discord')return'discord';return'other'}
async function ingest(t:string,item:any,sub:any,owner:string){const adapter=trim(sub?.payload_json?.adapter,40).toLowerCase();const profile=trim(sub?.payload_json?.source_profile,60)||'community_social';const subtype=adapter==='reddit_rss'?'reddit_post':adapter==='x_api'?'x_post':adapter==='discord'?'discord_message':'social_post';const body:any={_scheduler_user_id:owner,url:item.url,rendered_title:item.title,rendered_text:item.summary,author:item.author,published_at:item.published_at,source_type:sourceType(adapter),source_name:trim(sub.source,120),source_profile:profile,source_subtype:subtype};const r=await fetch(`${U}/functions/v1/market-intel-ingest`,{method:'POST',headers:H(t),body:JSON.stringify(body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`Ingest ${r.status}`);return d}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const caller=bearer(req);if(!caller||!(await serviceAuth(caller)))return J({error:'Service authentication required'},401);
  if(!S)return J({error:'Service role unavailable'},500);
  let b:any;try{b=await req.json()}catch{b={}}
  const maxNew=Math.max(1,Math.min(Number(b?.max_new)||1,4));
  try{
    const subs=await rest(S,'source_captures?select=user_id,source,source_key,payload_json&capture_type=eq.social_subscription&order=captured_at.asc&limit=100');
    const enabled=(subs||[]).filter((x:any)=>UUID.test(String(x.user_id||''))&&x?.payload_json?.enabled!==false&&x?.source_key);
    const report:any[]=[];let attempted=0,saved=0,duplicates=0,failed=0,skippedSaved=0,skippedFailed=0,morePending=false,stop=false;
    for(const sub of enabled){
      if(stop)break;
      const owner=String(sub.user_id),adapter=trim(sub?.payload_json?.adapter,40).toLowerCase(),feedUrl=safeUrl(String(sub.source_key));
      const out:any={source:trim(sub.source,120),adapter,scanned:0,attempted:0,saved:0,duplicates:0,failed:0,errors:[]};
      if(adapter!=='reddit_rss'){out.errors.push(`Adapter ${adapter||'unknown'} is not enabled yet`);report.push(out);continue}
      try{
        const maxItems=Math.max(1,Math.min(Number(sub?.payload_json?.max_items)||8,15));
        const items=parseFeed(await fetchXml(feedUrl),feedUrl).slice(0,maxItems);
        for(const item of items){
          out.scanned++;
          const existing=await rest(S,`source_captures?select=capture_id,metadata_json&user_id=eq.${encodeURIComponent(owner)}&source=eq.${encodeURIComponent(String(sub.source))}&capture_type=eq.social_item&source_key=eq.${encodeURIComponent(item.url)}&limit=1`).catch(()=>[]),row=existing?.[0];
          if(row?.metadata_json?.status==='saved'){skippedSaved++;continue}
          if(failedRecently(row)){skippedFailed++;continue}
          if(attempted>=maxNew){morePending=true;stop=true;break}
          attempted++;out.attempted++;
          let captureId=row?.capture_id||null;
          if(!captureId){const inserted=await rest(S,'source_captures',{method:'POST',prefer:'return=representation',body:{user_id:owner,source:trim(sub.source,120),capture_type:'social_item',source_key:item.url,content_type:'application/social+item',payload_json:{title:item.title,author:item.author,published_at:item.published_at,adapter,feed_url:feedUrl,source_profile:trim(sub?.payload_json?.source_profile,60)||'community_social'},payload_text:item.summary||null,content_hash:await sha(`${item.url}|${item.title}|${item.summary}`),metadata_json:{status:'pending',adapter,feed_url:feedUrl}}});captureId=(Array.isArray(inserted)?inserted[0]:inserted)?.capture_id||null}
          try{const result=await ingest(S,item,sub,owner);const s=Number(result?.saved||0),d=Number(result?.duplicates||0);saved+=s;duplicates+=d;out.saved+=s;out.duplicates+=d;if(captureId)await rest(S,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',body:{metadata_json:{status:'saved',adapter,feed_url:feedUrl,ingested_at:new Date().toISOString(),saved:s,duplicates:d}}})}
          catch(e){failed++;out.failed++;out.errors.push(`${item.title}: ${(e as Error).message}`);if(captureId)await rest(S,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',body:{metadata_json:{status:'failed',adapter,feed_url:feedUrl,last_error:(e as Error).message,last_attempt_at:new Date().toISOString()}}}).catch(()=>null)}
        }
      }catch(e){failed++;out.failed++;out.errors.push((e as Error).message)}
      report.push(out);
    }
    if(!stop){for(const sub of enabled){if(trim(sub?.payload_json?.adapter,40).toLowerCase()!=='reddit_rss')continue;const owner=String(sub.user_id),feedUrl=safeUrl(String(sub.source_key));try{const items=parseFeed(await fetchXml(feedUrl),feedUrl).slice(0,Math.max(1,Math.min(Number(sub?.payload_json?.max_items)||8,15)));for(const item of items){const existing=await rest(S,`source_captures?select=metadata_json&user_id=eq.${encodeURIComponent(owner)}&source=eq.${encodeURIComponent(String(sub.source))}&capture_type=eq.social_item&source_key=eq.${encodeURIComponent(item.url)}&limit=1`).catch(()=>[]),row=existing?.[0];if(row?.metadata_json?.status==='saved'||failedRecently(row))continue;morePending=true;break}}catch{}if(morePending)break}}
    return J({ok:true,subscriptions:enabled.length,attempted,saved,duplicates,failed,skipped_saved:skippedSaved,skipped_failed:skippedFailed,more_pending:morePending,report});
  }catch(e){return J({error:(e as Error).message},502)}
});
