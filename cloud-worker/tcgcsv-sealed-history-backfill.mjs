import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const BASE=(process.env.TCGCSV_BASE_URL||'https://tcgcsv.com').replace(/\/$/,'');
const MAX=Math.max(1,Math.min(12,Number(process.env.TCGCSV_HISTORY_MAX_ARCHIVES||3)));
const STRIDE=Math.max(1,Number(process.env.TCGCSV_HISTORY_STRIDE_DAYS||7));
const START=process.env.TCGCSV_HISTORY_START||'2024-02-08';
const END=process.env.TCGCSV_HISTORY_END||new Date(Date.now()-86400000).toISOString().slice(0,10);
const UA=process.env.TCGCSV_USER_AGENT||'Collectish-MarketplaceScout/1.0 (+https://github.com/joe-nasti/marketplacescout)';
if(!URL||!KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};

async function sb(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(`Supabase ${r.status}: ${String(text).slice(0,300)}`);return data;
}
const iso=d=>d.toISOString().slice(0,10);
const dateRange=()=>{const out=[];for(let d=new Date(`${END}T00:00:00Z`),floor=new Date(`${START}T00:00:00Z`);d>=floor;d=new Date(d.getTime()-STRIDE*86400000))out.push(iso(d));return out};
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const run=(cmd,args)=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:'inherit'});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(new Error(`${cmd} exited ${c}`)))});
async function status(date,patch){await sb('sealed_tcgcsv_archive_imports?on_conflict=archive_date',{method:'POST',body:[{archive_date:date,...patch}],prefer:'resolution=merge-duplicates,return=minimal'})}

async function targets(){
  const products=await sb("mtgjson_sealed_products?select=tcgplayer_product_id&category=eq.booster_box&subtype=eq.collector&tcgplayer_product_id=not.is.null&name=not.ilike.*case*")||[];
  const ids=[...new Set(products.map(x=>Number(x.tcgplayer_product_id)).filter(Number.isFinite))];
  const groupByProduct=new Map();
  for(let i=0;i<ids.length;i+=100){
    const part=ids.slice(i,i+100),rows=await sb(`tcgcsv_tcgplayer_prices?select=product_id,group_id&product_id=in.(${part.join(',')})` )||[];
    for(const row of rows)groupByProduct.set(Number(row.product_id),Number(row.group_id));
  }
  return{ids:new Set(ids),groups:[...new Set(groupByProduct.values())].filter(Number.isFinite)};
}

async function download(url,path){
  const r=await fetch(url,{headers:{'User-Agent':UA}});
  if(r.status===404)return false;if(!r.ok)throw new Error(`Archive HTTP ${r.status}`);
  await pipeline(r.body,createWriteStream(path));return true;
}

async function importDate(date,target){
  const dir=await mkdtemp(join(tmpdir(),'collectish-sealed-history-'));
  try{
    await status(date,{status:'running',attempted_at:new Date().toISOString(),target_products:target.ids.size,detail:{strideDays:STRIDE}});
    const archive=join(dir,`prices-${date}.ppmd.7z`),ok=await download(`${BASE}/archive/tcgplayer/prices-${date}.ppmd.7z`,archive);
    if(!ok){await status(date,{status:'missing',completed_at:new Date().toISOString(),detail:{httpStatus:404}});return{date,status:'missing',rows:0}}
    const output=join(dir,'out');
    await run('7z',['x',archive,`-o${output}`,'-y',...target.groups.map(g=>`${date}/1/${g}/prices`)]);
    const rows=[];
    for(const group of target.groups){
      const file=join(output,date,'1',String(group),'prices');
      let parsed;try{parsed=JSON.parse(await readFile(file,'utf8'))}catch{continue}
      for(const p of Array.isArray(parsed?.results)?parsed.results:Array.isArray(parsed)?parsed:[]){
        const id=Number(p?.productId);if(!target.ids.has(id))continue;
        rows.push({product_id:id,observed_on:date,sub_type_name:String(p?.subTypeName||'Normal'),market_price:num(p?.marketPrice),low_price:num(p?.lowPrice),direct_low_price:num(p?.directLowPrice),source:'tcgcsv_archive',source_granularity:STRIDE===1?'daily':`sampled_${STRIDE}d`,source_updated_at:`${date}T20:00:00Z`});
      }
    }
    for(let i=0;i<rows.length;i+=250)await sb('sealed_product_market_history?on_conflict=product_id,sub_type_name,observed_on',{method:'POST',body:rows.slice(i,i+250),prefer:'resolution=merge-duplicates,return=minimal'});
    await status(date,{status:'complete',completed_at:new Date().toISOString(),imported_rows:rows.length,detail:{groups:target.groups.length,strideDays:STRIDE}});
    return{date,status:'complete',rows:rows.length};
  }catch(error){await status(date,{status:'failed',completed_at:new Date().toISOString(),detail:{error:String(error?.message||error).slice(0,500)}}).catch(()=>{});throw error}
  finally{await rm(dir,{recursive:true,force:true})}
}

const target=await targets();
const done=await sb('sealed_tcgcsv_archive_imports?select=archive_date,status&status=in.(complete,missing)')||[];
const completed=new Set(done.map(x=>x.archive_date));
const pending=dateRange().filter(d=>!completed.has(d)).slice(0,MAX),report=[];
for(const date of pending){try{report.push(await importDate(date,target))}catch(error){report.push({date,status:'failed',error:String(error?.message||error)})}}
console.log(JSON.stringify({ok:report.every(x=>x.status!=='failed'),targetProducts:target.ids.size,targetGroups:target.groups.length,pending:pending.length,report},null,2));
if(report.some(x=>x.status==='failed'))process.exitCode=1;
