import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:t===S&&S?S:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const trim=(x:any,n=2000)=>String(x??'').trim().slice(0,n);
const FAILED_COOLDOWN_MS=6*60*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
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
function profileOf(f:any){return trim(f?.payload_json?.source_profile||'generic_editorial',60).toLowerCase()||'generic_editorial'}
function sourceSubtype(item:any,profile:string){
  const hay=`${item?.title||''} ${item?.summary||''}`.toLowerCase();
  if(profile==='retailer_editorial'){
    if(/\b(top|our)\s+\d*\s*(best[- ]?selling|top[- ]?selling)|\bbest[- ]?selling\b|\btop[- ]?selling\b|\bmost in demand\b/.test(hay))return'first_party_sales';
    if(/\breprint|reprinted|reprints\b/.test(hay))return'retailer_reprint_editorial';
    if(/\bban(ned|s)?|banned and restricted|b&r\b/.test(hay))return'retailer_news';
    return'retailer_opinion';
  }
  if(profile==='marketplace_editorial'){
    if(/\btop[- ]?selling\b|\bbest[- ]?selling\b|\bhighest total number of copies sold\b|\bcopies sold\b/.test(hay))return'first_party_market_sales';
    if(/\bprice trends?\b|\bclimbing in price\b|\bmarket price\b|\bprice increases?\b/.test(hay))return'first_party_market_price';
    if(/\bdirect\b|\bmarketplace fees?\b|\bminimum pricing\b|\bseller(s)?\b|\bpolicy\b|\bstore your products\b|\bsyp\b/.test(hay))return'marketplace_operations';
    return'marketplace_editorial';
  }
  return profile;
}
function failedRecently(row:any){if(row?.metadata_json?.status!=='failed')return false;const at=Date.parse(String(row?.metadata_json?.last_attempt_at||''));return Number.isFinite(at)&&Date.now()-at<FAILED_COOLDOWN_MS}
async function sha(value:string){const bytes=new TextEncoder().encode(value),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function ingest(t:string,item:any,sourceName:string,profile:string,subtype:string,owner:string,scheduler:boolean){const body:any={url:item.url,rendered_title:item.title,author:item.author,published_at:item.published_at,source_type:'article',source_name:sourceName,source_profile:profile,source_subtype:subtype};if(scheduler)body._scheduler_user_id=owner;if(!['retailer_editorial','marketplace_editorial','finance_editorial'].includes(profile)&&String(item.summary||'').trim().length>=120)body.rendered_text=item.summary;const r=await fetch(`${U}/functions/v1/market-intel-ingest`,{method:'POST',headers:H(t),body:JSON.stringify(body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`Ingest ${r.status}`);return d}
async function subscriptions(t:string,b:any,scheduler:boolean){
  if(b?.feed_url){if(scheduler)throw Error('Scheduled sync only processes persisted feed subscriptions');const url=safeUrl(String(b.feed_url));return [{source:trim(b.source_name,120)||new URL(url).hostname,source_key:url,payload_json:{feed_url:url,enabled:true,max_items:Number(b.max_items)||5,source_profile:trim(b.source_profile,60)||'generic_editorial'}}]}
  const select=scheduler?'user_id,source,source_key,payload_json':'source,source_key,payload_json';
  const rows=await rest(t,`source_captures?select=${select}&capture_type=eq.feed_subscription&order=captured_at.asc&limit=100`);
  return (rows||[]).filter((x:any)=>x?.payload_json?.enabled!==false&&x?.source_key&&(!scheduler||UUID.test(String(x.user_id||''))));
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const caller=bearer(req);if(!caller)return J({error:'Authentication required'},401);
  let b:any;try{b=await req.json()}catch{b={}}
  const scheduler=await serviceAuth(caller);let user:any=null;
  if(!scheduler){try{user=await auth(caller)}catch{return J({error:'Authentication required'},401)}}
  if(scheduler&&!S)return J({error:'Service role unavailable'},500);
  const t=scheduler?S:caller;
  try{
    const feeds=await subscriptions(t,b,scheduler),report:any[]=[];
    let attempted=0,totalSaved=0,totalDuplicates=0,totalFailed=0,totalScanned=0,skippedSaved=0,skippedFailed=0,morePending=false;
    const maxNew=Math.max(1,Math.min(Number(b?.max_new)||Number(b?.max_total)||1,scheduler?6:2));
    let stop=false;
    for(const f of feeds){
      if(stop)break;
      const owner=scheduler?String(f.user_id||''):String(user.id||'');if(!UUID.test(owner))continue;
      const feedUrl=safeUrl(String(f.source_key)),sourceName=trim(f.source,120)||new URL(feedUrl).hostname,maxItems=Math.max(1,Math.min(Number(f?.payload_json?.max_items)||5,10)),sourceProfile=profileOf(f);
      const out:any={source:sourceName,feed_url:feedUrl,source_profile:sourceProfile,scanned:0,attempted:0,saved:0,duplicates:0,skipped_saved:0,skipped_failed:0,failed:0,errors:[]};
      try{
        const xml=await getFeed(feedUrl),items=parseFeed(xml,feedUrl).slice(0,maxItems);
        for(const item of items){
          out.scanned++;totalScanned++;
          const key=item.url,subtype=sourceSubtype(item,sourceProfile),ownerFilter=`&user_id=eq.${encodeURIComponent(owner)}`;
          const existing=await rest(t,`source_captures?select=capture_id,metadata_json&source=eq.${encodeURIComponent(sourceName)}&capture_type=eq.feed_item&source_key=eq.${encodeURIComponent(key)}${ownerFilter}&limit=1`).catch(()=>[]);
          const row=existing?.[0];
          if(row?.metadata_json?.status==='saved'){out.skipped_saved++;skippedSaved++;continue}
          if(failedRecently(row)){out.skipped_failed++;skippedFailed++;continue}
          if(attempted>=maxNew){morePending=true;stop=true;break}
          attempted++;out.attempted++;
          let captureId=row?.capture_id||null;
          if(!captureId){
            const inserted=await rest(t,'source_captures',{method:'POST',prefer:'return=representation',body:{user_id:owner,source:sourceName,capture_type:'feed_item',source_key:key,content_type:'application/feed+item',payload_json:{title:item.title,published_at:item.published_at,author:item.author,feed_url:feedUrl,source_profile:sourceProfile,source_subtype:subtype},payload_text:item.summary||null,content_hash:await sha(`${item.url}|${item.title}|${item.summary}`),metadata_json:{status:'pending',feed_url:feedUrl,source_profile:sourceProfile,source_subtype:subtype}}});
            captureId=(Array.isArray(inserted)?inserted[0]:inserted)?.capture_id||null;
          }
          try{
            const result=await ingest(t,item,sourceName,sourceProfile,subtype,owner,scheduler);const saved=Number(result?.saved||0),dupes=Number(result?.duplicates||0);
            out.saved+=saved;out.duplicates+=dupes;totalSaved+=saved;totalDuplicates+=dupes;
            if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'saved',feed_url:feedUrl,source_profile:sourceProfile,source_subtype:subtype,ingested_at:new Date().toISOString(),saved,duplicates:dupes}}});
          }catch(e){out.failed++;totalFailed++;out.errors.push(`${item.title}: ${(e as Error).message}`);if(captureId)await rest(t,`source_captures?capture_id=eq.${encodeURIComponent(captureId)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',prefer:'return=minimal',body:{metadata_json:{status:'failed',feed_url:feedUrl,source_profile:sourceProfile,source_subtype:subtype,last_error:(e as Error).message,last_attempt_at:new Date().toISOString()}}}).catch(()=>null)}
        }
      }catch(e){out.failed++;totalFailed++;out.errors.push((e as Error).message)}
      report.push(out);
    }
    if(!stop){
      for(const f of feeds){
        const owner=scheduler?String(f.user_id||''):String(user.id||'');if(!UUID.test(owner))continue;
        const feedUrl=safeUrl(String(f.source_key)),sourceName=trim(f.source,120)||new URL(feedUrl).hostname,maxItems=Math.max(1,Math.min(Number(f?.payload_json?.max_items)||5,10));
        try{
          const items=parseFeed(await getFeed(feedUrl),feedUrl).slice(0,maxItems);
          for(const item of items){
            const existing=await rest(t,`source_captures?select=metadata_json&source=eq.${encodeURIComponent(sourceName)}&capture_type=eq.feed_item&source_key=eq.${encodeURIComponent(item.url)}&user_id=eq.${encodeURIComponent(owner)}&limit=1`).catch(()=>[]),row=existing?.[0];
            if(row?.metadata_json?.status==='saved'||failedRecently(row))continue;
            morePending=true;break;
          }
        }catch{}
        if(morePending)break;
      }
    }
    return J({ok:true,mode:scheduler?'scheduled':'user',feeds:report.length,scanned:totalScanned,attempted,saved:totalSaved,duplicates:totalDuplicates,skipped_saved:skippedSaved,skipped_failed:skippedFailed,failed:totalFailed,more_pending:morePending,report});
  }catch(e){return J({error:(e as Error).message},502)}
});
