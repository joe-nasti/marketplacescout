// Collectish SYP orchestrator.
// Coordinates authenticated read-only Android jobs for the private TCGplayer
// Store Your Products endpoints recovered from collectish-syp-monitor v0.2.1.
// This process never calls TCGplayer directly.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
const FULL_REFRESH_MS=24*60*60*1000;
const LAST_UPDATED_URL='https://store.tcgplayer.com/admin/direct/GetLastUpdated?categoryId=1';
const EXPORT_URL='https://store.tcgplayer.com/admin/direct/ExportSYPList?categoryid=1&setNameId=&conditionId=';

async function sb(path,{method='GET',body,prefer}={}){
  const headers={...H,...(prefer?{Prefer:prefer}:{})};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(d?.message||d?.hint||`Supabase HTTP ${r.status}`);
  return d;
}
const enc=v=>encodeURIComponent(String(v??''));
const nowIso=()=>new Date().toISOString();
function probeBody(job){return job?.progress_json?.readOnlyProbe?.body ?? null}
function cleanLastUpdated(value){let s=String(value??'').trim();try{const p=JSON.parse(s);s=typeof p==='string'?p.trim():String(p)}catch{}return s.replace(/^"|"$/g,'').trim()}
function snapshotId(lastUpdated){return `magic-${String(lastUpdated||nowIso()).replace(/[^0-9A-Za-z]+/g,'-').replace(/^-|-$/g,'')}`}
function parseCsv(text){const rows=[];let row=[],field='',q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(q){if(c==='"'&&n==='"'){field+='"';i++}else if(c==='"')q=false;else field+=c}else{if(c==='"')q=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}else field+=c}}if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}const ne=rows.filter(r=>r.some(v=>String(v).trim()!==''));if(!ne.length)return[];const h=ne[0].map(x=>x.trim());return ne.slice(1).map(v=>Object.fromEntries(h.map((x,i)=>[x,v[i]??''])))}
function pick(o,names){for(const n of names)if(Object.prototype.hasOwnProperty.call(o,n))return o[n];return''}
function num(v){const s=String(v??'').replace(/[$,]/g,'').trim();if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null}
function normalizeCsv(csv){return parseCsv(csv).map(raw=>({tcgplayerId:String(pick(raw,['TCGplayer Id','TCGPlayer Id','TCGplayer ID','TCGPlayer ID'])).trim(),productLine:String(pick(raw,['Category','Product Line'])).trim(),product:String(pick(raw,['Product Name','Product'])).trim(),number:String(pick(raw,['Number'])).trim(),rarity:String(pick(raw,['Rarity'])).trim(),set:String(pick(raw,['Set','Set Name'])).trim(),condition:String(pick(raw,['Condition'])).trim(),marketPrice:num(pick(raw,['Market Price','TCG Market Price'])),maxQuantity:Math.trunc(num(pick(raw,['Max QTY','Max Qty','Max Quantity','MaxQuantity']))??0)})).filter(r=>r.tcgplayerId)}
function makeEvent(snap,id,type,row,oldValue,newValue,extra={}){return{user_id:null,event_id:`${snap.snapshot_id}:${id}:${type}`,snapshot_id:snap.snapshot_id,tcgplayer_id:id,product_name:row?.product||null,set_name:row?.set||null,event_type:type,old_value:oldValue,new_value:newValue,difference:oldValue!=null&&newValue!=null?newValue-oldValue:null,metadata_changes:extra.metadataChanges||{},changed_at:snap.last_updated||snap.captured_at,collected_at:nowIso(),raw_json:{eventId:`${snap.snapshot_id}:${id}:${type}`,snapshotId:snap.snapshot_id,tcgplayerId:id,product:row?.product||null,set:row?.set||null,eventType:type,oldValue,newValue,difference:oldValue!=null&&newValue!=null?newValue-oldValue:null,metadataChanges:extra.metadataChanges||{},changedAt:snap.last_updated||snap.captured_at}}}
async function mark(job,extra){await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}`,{method:'PATCH',body:{progress_json:{...(job.progress_json||{}),sypOrchestratedAt:nowIso(),...extra}},prefer:'return=minimal'})}
async function latestSnapshot(userId){const r=await sb(`syp_snapshots?select=*&user_id=eq.${enc(userId)}&order=captured_at.desc&limit=1`);return r?.[0]||null}
function fullRefreshDue(latest){if(!latest?.captured_at)return true;const captured=Date.parse(latest.captured_at);return !Number.isFinite(captured)||Date.now()-captured>=FULL_REFRESH_MS}
async function active(userId,kind){const r=await sb(`collector_jobs?select=*&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&status=in.(queued,claimed,running,completed)&order=created_at.desc&limit=200`);return (r||[]).some(j=>j.payload_json?.sypKind===kind&&(['queued','claimed','running'].includes(j.status)||(j.status==='completed'&&!j.progress_json?.sypOrchestratedAt)))}
async function queueProbe(userId,kind,url,extra={}){if(await active(userId,kind))return false;await sb('collector_jobs',{method:'POST',body:[{user_id:userId,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:8,required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',payload_json:{sypKind:kind,...extra,probe:{mode:'fetch_text',method:'GET',url}},progress_json:{stage:'queued',percent:0,detail:`SYP ${kind} read-only probe queued`,updatedAt:nowIso()},max_attempts:3}],prefer:'return=minimal'});return true}

async function processExport(job,lastUpdated,csv){
  const rows=normalizeCsv(csv);if(!rows.length)throw new Error('SYP export returned no recognizable rows');
  const capturedAt=nowIso(),sid=snapshotId(lastUpdated);
  const snap={user_id:job.user_id,snapshot_id:sid,category_id:1,category_name:'Magic',set_name_id:'',condition_id:'',last_updated:lastUpdated,captured_at:capturedAt,row_count:rows.length,data_version:2,collected_at:capturedAt,raw_json:{snapshotId:sid,categoryId:1,categoryName:'Magic',setNameId:'',conditionId:'',lastUpdated,capturedAt,rowCount:rows.length,dataVersion:2}};
  const old=await sb(`syp_products?select=*&user_id=eq.${enc(job.user_id)}&limit=50000`),oldMap=new Map((old||[]).map(x=>[String(x.tcgplayer_id),x])),currentIds=new Set(rows.map(x=>x.tcgplayerId)),events=[],products=[];
  for(const row of rows){
    const o=oldMap.get(row.tcgplayerId),first=o?.first_seen||lastUpdated||capturedAt;
    if(!o)events.push(makeEvent(snap,row.tcgplayerId,'ADDED',row,null,row.maxQuantity));
    else{
      const oq=Number(o.current_max_quantity??o.max_quantity??0);
      if(oq!==row.maxQuantity)events.push(makeEvent(snap,row.tcgplayerId,row.maxQuantity>oq?'MAX_QUANTITY_INCREASED':'MAX_QUANTITY_DECREASED',row,oq,row.maxQuantity));
      const ch={};for(const [k,col] of [['productLine','product_line'],['product','product_name'],['number','number'],['rarity','rarity'],['set','set_name'],['condition','condition']])if(String(o?.[col]??'')!==String(row[k]??''))ch[k]={old:o?.[col]??'',new:row[k]??''};
      if(Object.keys(ch).length)events.push(makeEvent(snap,row.tcgplayerId,'METADATA_CHANGED',row,null,null,{metadataChanges:ch}));
    }
    products.push({user_id:job.user_id,tcgplayer_id:row.tcgplayerId,product_line:row.productLine||null,product_name:row.product||null,number:row.number||null,rarity:row.rarity||null,set_name:row.set||null,condition:row.condition||null,market_price:row.marketPrice,max_quantity:row.maxQuantity,current_max_quantity:row.maxQuantity,first_seen:first,last_seen:lastUpdated||capturedAt,is_currently_eligible:true,collected_at:capturedAt,raw_json:{...row,firstSeen:first,lastSeen:lastUpdated||capturedAt,isCurrentlyEligible:true,currentMaxQuantity:row.maxQuantity}});
  }
  for(const [id,o] of oldMap)if(o.is_currently_eligible&&!currentIds.has(id)){events.push(makeEvent(snap,id,'REMOVED',{product:o.product_name,set:o.set_name},Number(o.current_max_quantity??o.max_quantity??0),null));products.push({...o,is_currently_eligible:false,last_seen:lastUpdated||capturedAt,collected_at:capturedAt,raw_json:{...(o.raw_json||{}),isCurrentlyEligible:false,lastSeen:lastUpdated||capturedAt}})}
  for(let i=0;i<products.length;i+=500)await sb('syp_products?on_conflict=user_id,tcgplayer_id',{method:'POST',body:products.slice(i,i+500),prefer:'resolution=merge-duplicates,return=minimal'});
  for(let i=0;i<events.length;i+=500){const b=events.slice(i,i+500).map(e=>({...e,user_id:job.user_id}));await sb('syp_events?on_conflict=user_id,event_id',{method:'POST',body:b,prefer:'resolution=merge-duplicates,return=minimal'})}
  await sb('syp_snapshots?on_conflict=user_id,snapshot_id',{method:'POST',body:[snap],prefer:'resolution=merge-duplicates,return=minimal'});
  await sb('source_captures?on_conflict=user_id,source,capture_type,source_key',{method:'POST',body:[{user_id:job.user_id,source:'tcgplayer',capture_type:'syp_csv',source_key:sid,captured_at:capturedAt,content_type:'text/csv',payload_text:csv,metadata_json:{lastUpdated,rowCount:rows.length}}],prefer:'resolution=ignore-duplicates,return=minimal'});
  return{rows:rows.length,events:events.length,snapshotId:sid};
}

async function main(){
  // Process newest results first so a fresh multi-megabyte SYP export cannot starve behind Seller detail completions.
  const completed=await sb('collector_jobs?select=*&source=eq.agent&action=eq.seller_portal_readonly_probe&status=eq.completed&order=completed_at.desc&limit=500');
  const users=new Set();let checks=0,exports=0,forced=0;
  for(const job of completed||[]){
    const k=job.payload_json?.sypKind;if(!k||job.progress_json?.sypOrchestratedAt)continue;
    users.add(job.user_id);
    try{
      if(k==='last_updated'){
        const lu=cleanLastUpdated(probeBody(job)),latest=await latestSnapshot(job.user_id);
        if(!lu)throw new Error('Empty SYP GetLastUpdated result');
        const unchanged=latest?.last_updated===lu,due=fullRefreshDue(latest);
        if(unchanged&&!due){await mark(job,{sypStatus:'no_change',sypLastUpdated:lu,sypFullRefreshDue:false});checks++;continue}
        const q=await queueProbe(job.user_id,'export',EXPORT_URL,{sypForcedRefresh:unchanged&&due});
        if(unchanged&&due)forced++;
        await mark(job,{sypStatus:q?(unchanged&&due?'export_queued_stale_snapshot':'export_queued'):'export_already_active',sypLastUpdated:lu,sypFullRefreshDue:due});
        checks++;continue;
      }
      if(k==='export'){
        const latestCheck=(completed||[]).filter(x=>x.user_id===job.user_id&&x.payload_json?.sypKind==='last_updated'&&x.progress_json?.sypLastUpdated).sort((a,b)=>new Date(b.completed_at)-new Date(a.completed_at))[0];
        const lu=latestCheck?.progress_json?.sypLastUpdated||nowIso();
        const out=await processExport(job,lu,String(probeBody(job)??''));
        await mark(job,{sypStatus:'snapshot_normalized',sypRows:out.rows,sypEvents:out.events,sypSnapshotId:out.snapshotId});exports++;
      }
    }catch(e){await mark(job,{sypStatus:'normalization_failed',sypError:String(e?.message||e)})}
  }
  const known=await sb('syp_snapshots?select=user_id&order=captured_at.desc&limit=20');for(const r of known||[])users.add(r.user_id);
  for(const userId of users)await queueProbe(userId,'last_updated',LAST_UPDATED_URL);
  console.log(`SYP orchestrator: ${checks} last-updated result(s), ${exports} export(s) processed, ${forced} stale snapshot refresh(es) requested, ${users.size} user(s) ensured.`);
}
await main();