import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const SUPADATA=Deno.env.get('SUPADATA_API_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=(t:string)=>({apikey:t===S&&S?S:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const trim=(x:any,n=4000)=>String(x??'').trim().slice(0,n);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NATIVE_RETRY_MS=72*60*60*1000;

async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(S),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function dec(s:string){return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')}
function tag(block:string,name:string){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?dec(m[1]).trim():''}
function attr(block:string,name:string,a:string){const m=block.match(new RegExp(`<${name}\\b[^>]*\\s${a}=[\"']([^\"']+)[\"'][^>]*>`,'i'));return m?dec(m[1]).trim():''}
function ytId(entry:string){return tag(entry,'yt:videoId')||((attr(entry,'link','href').match(/[?&]v=([A-Za-z0-9_-]{6,})/)||[])[1]||'')}
function mmss(ms:number){const s=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function unavailableRecently(row:any){if(row?.metadata_json?.status!=='unavailable_native')return false;const at=Date.parse(String(row?.metadata_json?.last_attempt_at||''));return Number.isFinite(at)&&Date.now()-at<NATIVE_RETRY_MS}
function eventStats(result:any){return{events_considered:Number(result?.events_considered||0),rejected_cards:Number(result?.rejected_cards||0),below_threshold:Number(result?.below_threshold||0),duplicates:Number(result?.duplicates||0),window_count:Number(result?.window_count||0)}}
async function fetchFeed(channelId:string){const url=`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;let lastStatus=0;for(const delay of [0,1200,4000,9000]){if(delay)await sleep(delay);try{const r=await fetch(url,{headers:{'User-Agent':'collectish-signals/1.0','Accept':'application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'},redirect:'follow'});lastStatus=r.status;if(!r.ok)continue;const xml=await r.text();const items=[...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(m=>m[1]).map(e=>{const video_id=ytId(e),title=tag(e,'title');return{video_id,title,url:attr(e,'link','href')||`https://www.youtube.com/watch?v=${video_id}`,published_at:tag(e,'published')||null,channel_name:tag(tag(e,'author'),'name')||null}}).filter(x=>x.video_id&&x.title);if(items.length)return items}catch{}}throw Error(`YouTube RSS ${lastStatus||'unavailable'} after retries`)}
async function transcript(url:string){const q=new URLSearchParams({url,mode:'native',text:'false',lang:'en',chunkSize:'700'});const r=await fetch(`https://api.supadata.ai/v1/transcript?${q}`,{headers:{'x-api-key':SUPADATA,'Accept':'application/json'}});const billable=Number(r.headers.get('x-billable-requests')||0)||0;const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}};if(r.status===206)return{available:false,billable,status:206,error:d?.error||'transcript-unavailable'};if(!r.ok)throw Object.assign(Error(d?.message||d?.error||`Supadata ${r.status}`),{billable});if(!Array.isArray(d?.content))throw Error('Supadata returned no timestamped content');return{available:true,billable,status:r.status,lang:d.lang||null,availableLangs:d.availableLangs||[],segments:d.content.map((x:any)=>({text:trim(x?.text,1200),offset:Number(x?.offset)||0,duration:Number(x?.duration)||0,lang:x?.lang||d.lang||null})).filter((x:any)=>x.text)}}
async function extractEvents(item:any,sub:any,owner:string,segments:any[]){const lane=trim(sub?.payload_json?.creator_lane||item?.creator_lane,40)||'general';const r=await fetch(`${U}/functions/v1/market-intel-video-event-extract`,{method:'POST',headers:H(S),body:JSON.stringify({user_id:owner,video_id:item.video_id,video_url:item.url||`https://www.youtube.com/watch?v=${item.video_id}`,video_title:item.title||null,published_at:item.published_at||null,channel_id:sub?.payload_json?.channel_id||item.channel_id||null,channel_name:item.channel_name||sub?.source||null,creator_lane:lane,segments})});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`Video event extract ${r.status}`);return d}
async function reprocessCached(){const rows=await rest('source_captures?select=capture_id,user_id,source,payload_json,metadata_json&capture_type=eq.video_transcript&order=captured_at.desc&limit=50').catch(()=>[]);for(const row of rows||[]){if(!UUID.test(String(row.user_id||''))||row?.metadata_json?.status!=='saved'||row?.metadata_json?.event_extracted_at)continue;const p=row.payload_json||{},segments=Array.isArray(p.segments)?p.segments:[];if(!p.video_id||!segments.length)continue;const item={video_id:p.video_id,url:p.url,title:p.title,published_at:p.published_at,channel_id:p.channel_id,channel_name:row.source,creator_lane:p.creator_lane};let result:any={events_saved:0};let error:string|null=null;try{result=await extractEvents(item,{source:row.source,payload_json:{channel_id:p.channel_id,creator_lane:p.creator_lane}},String(row.user_id),segments)}catch(e){error=(e as Error).message}const stats=eventStats(result),meta:any={...(row.metadata_json||{}),events_saved:Number(result?.events_saved||0),event_error:error,event_stats:stats};if(!error)meta.event_extracted_at=new Date().toISOString();else delete meta.event_extracted_at;await rest(`source_captures?capture_id=eq.${encodeURIComponent(row.capture_id)}&user_id=eq.${encodeURIComponent(row.user_id)}`,{method:'PATCH',body:{metadata_json:meta}}).catch(()=>null);return{processed:true,events_saved:Number(result?.events_saved||0),error,video_id:p.video_id,stats}}return{processed:false,events_saved:0,error:null,video_id:null,stats:null}}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const caller=bearer(req);if(!caller||!(await serviceAuth(caller)))return J({error:'Service authentication required'},401);
  if(!S)return J({error:'Service role unavailable'},500);
  if(!SUPADATA)return J({error:'SUPADATA_API_KEY not configured'},500);
  let b:any={};try{b=await req.json()}catch{}
  const maxTranscripts=Math.max(1,Math.min(Number(b?.max_transcripts)||1,3));
  const backfillDays=Math.max(1,Math.min(Number(b?.backfill_days)||14,60));
  const cutoff=Date.now()-backfillDays*86400000;
  try{
    const cached=await reprocessCached();
    if(cached.processed)return J({ok:true,subscriptions:null,max_transcripts:maxTranscripts,transcript_attempts:0,billable_credits_observed:0,saved:cached.events_saved,duplicates:0,events_saved:cached.events_saved,unavailable_native:0,failed:cached.error?1:0,skipped:0,cached_reprocessed:1,cached_video_id:cached.video_id,cached_event_stats:cached.stats,policy:{transcript_mode:'native',ai_generation:false,per_run_cap:maxTranscripts,rss_retry_count:4,native_retry_hours:72,cache_first:true},report:cached.error?[{source:'cached transcript',failed:1,error:cached.error}]:[]});
    const subs=await rest('source_captures?select=user_id,source,source_key,payload_json&capture_type=eq.video_subscription&order=captured_at.asc&limit=100');
    const enabled=(subs||[]).filter((x:any)=>UUID.test(String(x.user_id||''))&&x?.payload_json?.enabled!==false&&x?.payload_json?.channel_id);
    let transcriptAttempts=0,billableCredits=0,eventsSaved=0,unavailable=0,failed=0,skipped=0,stop=false;const report:any[]=[];
    for(const sub of enabled){
      const owner=String(sub.user_id),channelId=String(sub.payload_json.channel_id),lane=trim(sub.payload_json.creator_lane,40)||'general';
      const out:any={source:sub.source,channel_id:channelId,lane,scanned:0,fetched:0,events_saved:0,unavailable:0,failed:0};
      try{
        const items=await fetchFeed(channelId);
        for(const item of items){
          out.scanned++;const pub=Date.parse(String(item.published_at||''));if(Number.isFinite(pub)&&pub<cutoff)continue;
          const sourceKey=`youtube:${item.video_id}:transcript`;const prior=await rest(`source_captures?select=capture_id,metadata_json&user_id=eq.${encodeURIComponent(owner)}&capture_type=eq.video_transcript&source_key=eq.${encodeURIComponent(sourceKey)}&limit=1`).catch(()=>[]),row=prior?.[0];
          if(row?.metadata_json?.status==='saved'||unavailableRecently(row)){skipped++;continue}
          if(transcriptAttempts>=maxTranscripts){stop=true;break}
          transcriptAttempts++;out.fetched++;
          try{
            const tr:any=await transcript(item.url);billableCredits+=Number(tr.billable)||0;
            if(!tr.available){unavailable++;out.unavailable++;await rest('source_captures',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{user_id:owner,source:item.channel_name||sub.source,capture_type:'video_transcript',source_key:sourceKey,content_type:'application/youtube+transcript',payload_json:{video_id:item.video_id,title:item.title,url:item.url,published_at:item.published_at,channel_id:channelId,creator_lane:lane},metadata_json:{status:'unavailable_native',provider:'supadata',mode:'native',billable:Number(tr.billable)||0,last_attempt_at:new Date().toISOString()}}}).catch(()=>null);continue}
            let eventResult:any={events_saved:0};let eventError:string|null=null;try{eventResult=await extractEvents(item,sub,owner,tr.segments);eventsSaved+=Number(eventResult?.events_saved||0);out.events_saved+=Number(eventResult?.events_saved||0);out.event_stats=eventStats(eventResult)}catch(e){eventError=(e as Error).message;failed++;out.failed++;out.error=eventError}
            const metadata:any={status:'saved',provider:'supadata',mode:'native',billable:Number(tr.billable)||0,segment_count:tr.segments.length,events_saved:Number(eventResult?.events_saved||0),event_error:eventError,event_stats:eventStats(eventResult),ingested_at:new Date().toISOString()};if(!eventError)metadata.event_extracted_at=new Date().toISOString();
            await rest('source_captures',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{user_id:owner,source:item.channel_name||sub.source,capture_type:'video_transcript',source_key:sourceKey,content_type:'application/youtube+transcript',payload_json:{video_id:item.video_id,title:item.title,url:item.url,published_at:item.published_at,channel_id:channelId,creator_lane:lane,lang:tr.lang,available_langs:tr.availableLangs,segments:tr.segments},payload_text:tr.segments.map((x:any)=>`[${mmss(x.offset)}] ${x.text}`).join('\n').slice(0,120000),metadata_json:metadata}});
          }catch(e){failed++;out.failed++;out.error=(e as Error).message;billableCredits+=Number((e as any)?.billable)||0}
        }
      }catch(e){failed++;out.failed++;out.error=(e as Error).message}
      report.push(out);if(stop)break;
    }
    return J({ok:true,subscriptions:enabled.length,max_transcripts:maxTranscripts,transcript_attempts:transcriptAttempts,billable_credits_observed:billableCredits,saved:eventsSaved,duplicates:0,events_saved:eventsSaved,unavailable_native:unavailable,failed,skipped,cached_reprocessed:0,policy:{transcript_mode:'native',ai_generation:false,per_run_cap:maxTranscripts,rss_retry_count:4,native_retry_hours:72,cache_first:true},report});
  }catch(e){return J({error:(e as Error).message},502)}
});
