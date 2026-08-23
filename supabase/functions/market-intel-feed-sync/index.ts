import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const trim=(x:any,n=2000)=>String(x??'').trim().slice(0,n);

async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const text=await r.text();let d:any;try{d=text?JSON.parse(text):null}catch{d=text}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function safeUrl(value:string,base?:string){const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol))throw Error('Only public http/https feeds are supported');const h=u.hostname.toLowerCase();if(h==='localhost'||h==='127.0.0.1'||h==='::1'||h.endsWith('.local'))throw Error('Private hosts are not supported');return u.toString()}
function dec(s:string){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')}
function text(s:string){return dec(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function tag(block:string,name:string){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?dec(m[1]).trim():''}
function attr(block:string,name:string,a:string){const m=block.match(new RegExp(`<${name}\\b[^>]*\\s${a}=[\"']([^\"']+)[\"'][^>]*>`,'i'));return m?dec(m[1]).trim():''}
async function getFeed(url:string){const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);try{const r=await fetch(safeUrl(url),{redirect:'follow',signal:c.signal,headers:{'User-Agent':'MarketplaceScout/0.4 (+market intelligence feed collector)','Accept':'application/atom+xml,application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'}});if(!r.ok)throw Error(`Feed HTTP ${r.status}`);return await r.text()}finally{clearTimeout(timer)}}
function parseFeed(xml:string,feedUrl:string){
  const atom=[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(m=>m[1]);
  const rss=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);
  const blocks=atom.length?atom:rss;
  return blocks.map((b,i)=>{
    const rawLink=attr(b,'link','href')||tag(b,'link')||tag(b,'guid');let url='';try{url=safeUrl(rawLink,feedUrl)}catch{}
    const title=text(tag(b,'title'))||`Feed item ${i+1}`;
    const summary=text(tag(b,'content')||tag(b,'content:encoded')||tag(b,'summary')||tag(b,'description')).slice(0,12000);
    const published=tag(b,'published')||tag(b,'updated')||tag(b,'pubDate')||null;
    const author=text(tag(tag(b,'author'),'name')||tag(b,'dc:creator')||tag(b,'author'))||null;
    return {url,title,summary,published_at:published,author};
  }).filter(x=>x.url);
}
async function sha(value:string){const bytes=new TextEncoder().encode(value),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function ingest(t:string,item:any,sourceName:string){const body:any={url:item.url,rendered_title:item.title,author:item.author,published_at:item.published_at,source_type:'article',source_name:sourceName};if(String(item.summary||'').trim().length>=120)body.rendered_text=item.summary;const r=await fetch(`${U}/functions/v1/market-intel-ingest`,{method:'POST',headers:H(t),body:JSON.stringify(body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`Ingest ${r.status}`);return d}
async function subscriptions(t:string,b:any){
  if(b?.feed_url){const url=safeUrl(String(b.feed_url));return [{source:trim(b.source_name,120)||new URL(url).hostname,source_key:url,payload_json:{feed_url:url,enabled:true,max_items:Number(b.max_items)||5}}]}
  const rows=await rest(t,"source_captures?select=source,source_key,payload_json&capture_type=eq.feed_subscription&order=captured_at.asc&limit=50");
  return (rows||[]).filter((x:any)=>x?.payload_json?.enabled!==false&&x?.source_key);
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t)return J({error:'Authentication required'},401);
  let user:any;try{user=await auth(t)}catch{return J({error:'Authentication required'},401)}
  let b:any;try{b=await req.json()}catch{b={}}
  try{
    const feeds=await subscriptions(t,b),report:any[]=[];
    let attempted=0,totalSaved=0,totalDuplicates=0,totalFailed=0,totalScanned=0,skippedSaved=0,morePending=false;
    // Analysis/ingest commonly takes 20–40s per item. Keep each Edge invocation to a
    // deliberately small resumable batch so it stays far below the platform wall-clock limit.
    const maxNew=Math.max(1,Math.min(Number(b?.max_new)||Number(b?.max_total)||1,2));
    let stop=false;
    for(const f of feeds){
      if(stop)break;
      const feedUrl=safeUrl(String(f.source_key)),sourceName=trim(f.source,120)||new URL(feedUrl).hostname,maxItems=Math.max(1,Math.min(Number(f?.payload_json?.max_items)||5,10));
      const out:any={source:sourceName,feed_url:feedUrl,scanned:0,attempted:0,saved:0,duplicates:0,skipped_saved:0,failed:0,errors:[]};
      try{
        const xml=await getFeed(feedUrl),items=parseFeed(xml,feedUrl).slice(0,maxItems);
        for(const item of items){
          out.scanned++;totalScanned++;
          const key=item.url;
          const existing=await rest(t,`source_captures?select=capture_id,metadata_json&source=eq.${encodeURIComponent(sourceName)}&capture_type=eq.feed_item&source_key=eq.${encodeURIComponent(key)}&limit=1`).catch(()=>[]);
          const row=existing?.[0];
          if(row?.metadata_json?.status==='saved'){out.skipped_saved++;skippedSaved++;continue}
          if(attempted>=maxNew){morePending=true;stop=true;break}
          attempted++;out.attempted++;
          let captureId=row?.capture_id||null;
          if(!captureId){
            const inserted=await rest(t,'source_captures',{method:'POST',prefer:'return=representation',body:{user_id:user.id,source:sourceName,capture_type:'feed_item',source_key:key,content_type:'application/feed+item',payload_json:{title:item.title,published_at:item.published_at,author:item.author,feed_url:feedUrl},payload_text:item.summary||null,content_hash:await sha(`${item.url}|${item.title}|${item.summary}`),metadata_json:{status:'pending',feed_url:feedUrl}}});
            captureId=(Array.isArray(inserted)?inserted[0]:inserted)?.capture_id||null;
          }
          try{
            const result=await ingest(t,item,sourceName);const saved=Number(result?.saved||0),dupes=Number(result?.duplicates||0);
            out.saved+=saved;out.duplicates+=dupes;totalSaved+=saved;totalDuplicates+=dupes;
            if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'saved',feed_url:feedUrl,ingested_at:new Date().toISOString(),saved,duplicates:dupes}}});
          }catch(e){out.failed++;totalFailed++;out.errors.push(`${item.title}: ${(e as Error).message}`);if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'failed',feed_url:feedUrl,last_error:(e as Error).message,last_attempt_at:new Date().toISOString()}}}).catch(()=>null)}
        }
      }catch(e){out.failed++;totalFailed++;out.errors.push((e as Error).message)}
      report.push(out);
    }
    return J({ok:true,feeds:report.length,scanned:totalScanned,attempted,saved:totalSaved,duplicates:totalDuplicates,skipped_saved:skippedSaved,failed:totalFailed,more_pending:morePending,report});
  }catch(e){return J({error:(e as Error).message},502)}
});
