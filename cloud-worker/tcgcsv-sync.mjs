// Collectish TCGCSV importer
// Preferred daily TCGplayer product-level pricing feed with MTGJSON fallback handled in SQL.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const BASE=(process.env.TCGCSV_BASE_URL||'https://tcgcsv.com').replace(/\/$/,'');
const CATEGORY_ID=Number(process.env.TCGCSV_CATEGORY_ID||1); // Magic
const BATCH=Math.max(25,Math.min(500,Number(process.env.TCGCSV_BATCH_SIZE||250)));
const REQUEST_DELAY_MS=Math.max(100,Number(process.env.TCGCSV_REQUEST_DELAY_MS||100));
const FORCE=/^(1|true|yes)$/i.test(String(process.env.TCGCSV_FORCE||''));
const USER_AGENT=process.env.TCGCSV_USER_AGENT||'Collectish-MarketplaceScout/1.0 (+https://github.com/joe-nasti/marketplacescout)';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
const now=()=>new Date().toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num=v=>Number.isFinite(Number(v))?Number(v):null;

async function sb(path,{method='GET',body,prefer}={}){
  const headers={...H,...(prefer?{Prefer:prefer}:{})};
  let last;
  for(let attempt=0;attempt<5;attempt++){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(r.ok)return data;
    last=new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,300)}`);
    if(![429,500,502,503,504].includes(r.status))throw last;
    await sleep(500*(2**attempt));
  }
  throw last;
}

async function tcg(path,{json=true}={}){
  let last;
  for(let attempt=0;attempt<5;attempt++){
    const r=await fetch(`${BASE}${path}`,{headers:{Accept:json?'application/json':'text/plain','User-Agent':USER_AGENT}});
    const text=await r.text();
    if(r.ok){await sleep(REQUEST_DELAY_MS);return json?JSON.parse(text):text.trim();}
    last=new Error(`TCGCSV ${path}: HTTP ${r.status} ${text.slice(0,200)}`);
    if(![429,500,502,503,504].includes(r.status))throw last;
    await sleep(1000*(2**attempt));
  }
  throw last;
}

async function upsert(table,rows,onConflict){
  let n=0;
  for(let i=0;i<rows.length;i+=BATCH){
    const part=rows.slice(i,i+BATCH);
    await sb(`${table}?on_conflict=${encodeURIComponent(onConflict)}`,{method:'POST',body:part,prefer:'resolution=merge-duplicates,return=minimal'});
    n+=part.length;
    if(i===0||n===rows.length||n%5000===0)console.log(`${table}: ${n}/${rows.length}`);
  }
  return n;
}

async function state(){
  const rows=await sb('tcgcsv_sync_state?feed=eq.tcgplayer_prices&select=*');
  return Array.isArray(rows)&&rows.length?rows[0]:null;
}
async function setState(patch){
  await sb('tcgcsv_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'tcgplayer_prices',...patch}],prefer:'resolution=merge-duplicates,return=minimal'});
}

function sourceDate(sourceUpdated){
  const d=new Date(sourceUpdated);
  if(Number.isNaN(d.getTime()))return new Date().toISOString().slice(0,10);
  return d.toISOString().slice(0,10);
}

async function main(){
  const started=now();
  await setState({last_started_at:started,status:'running',detail:{categoryId:CATEGORY_ID}});
  const sourceUpdated=await tcg('/last-updated.txt',{json:false});
  const prev=await state();
  if(!FORCE&&prev?.source_updated_at&&new Date(prev.source_updated_at).getTime()>=new Date(sourceUpdated).getTime()){
    console.log(`TCGCSV unchanged (${sourceUpdated}); skipping.`);
    await setState({source_updated_at:sourceUpdated,last_completed_at:now(),status:'complete',detail:{skipped:true,categoryId:CATEGORY_ID}});
    return;
  }

  const groupsDoc=await tcg(`/tcgplayer/${CATEGORY_ID}/groups`);
  const groups=Array.isArray(groupsDoc?.results)?groupsDoc.results:[];
  if(!groups.length)throw new Error(`TCGCSV returned no groups for category ${CATEGORY_ID}`);
  console.log(`TCGCSV source ${sourceUpdated}; ${groups.length} Magic groups.`);

  const observedOn=sourceDate(sourceUpdated);
  const rows=[];
  let fetched=0;
  for(const g of groups){
    const groupId=Number(g?.groupId);
    if(!Number.isFinite(groupId))continue;
    const doc=await tcg(`/tcgplayer/${CATEGORY_ID}/${groupId}/prices`);
    for(const p of Array.isArray(doc?.results)?doc.results:[]){
      const productId=Number(p?.productId);
      if(!Number.isFinite(productId))continue;
      rows.push({
        product_id:productId,
        group_id:groupId,
        sub_type_name:String(p?.subTypeName||'Normal'),
        low_price:num(p?.lowPrice),
        mid_price:num(p?.midPrice),
        high_price:num(p?.highPrice),
        market_price:num(p?.marketPrice),
        direct_low_price:num(p?.directLowPrice),
        observed_on:observedOn,
        source_updated_at:sourceUpdated
      });
    }
    fetched++;
    if(fetched%50===0)console.log(`Fetched ${fetched}/${groups.length} groups; ${rows.length} price rows.`);
  }

  await upsert('tcgcsv_tcgplayer_prices',rows,'product_id,sub_type_name,observed_on');
  await setState({source_updated_at:sourceUpdated,last_completed_at:now(),row_count:rows.length,status:'complete',detail:{categoryId:CATEGORY_ID,groups:groups.length,rows:rows.length,userAgent:USER_AGENT}});
  console.log(JSON.stringify({ok:true,sourceUpdated,observedOn,groups:groups.length,rows:rows.length},null,2));
}

try{await main();}
catch(e){
  try{await setState({last_completed_at:now(),status:'failed',detail:{error:String(e?.stack||e),categoryId:CATEGORY_ID}})}catch{}
  throw e;
}
