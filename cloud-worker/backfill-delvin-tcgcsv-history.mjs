import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const TCGCSV_BASE=(process.env.TCGCSV_BASE_URL||'https://tcgcsv.com').replace(/\/$/,'');
const USER_AGENT=process.env.TCGCSV_USER_AGENT||'Collectish/1.0 (+https://github.com/joe-nasti/marketplacescout)';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase HTTP ${r.status}: ${t.slice(0,240)}`);return d}
async function rpc(name,body={}){return sb(`rpc/${name}`,{method:'POST',body})}
function sh(cmd,args,cwd){
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args,{cwd,stdio:['ignore','pipe','pipe']});
    let out='',err='';
    p.stdout.on('data',d=>out+=d);
    p.stderr.on('data',d=>err+=d);
    p.on('error',reject);
    p.on('close',c=>c===0?resolve(out):reject(new Error(`${cmd} exited ${c}: ${err.slice(-600)}`)));
  });
}
const iso=d=>d.toISOString().slice(0,10);
function dates(start,end,step){const out=[],a=new Date(`${start}T00:00:00Z`),b=new Date(`${end}T00:00:00Z`);for(let d=new Date(a);d<=b;d.setUTCDate(d.getUTCDate()+step))out.push(iso(d));if(out.at(-1)!==iso(b))out.push(iso(b));return [...new Set(out)]}
function rowsFromJson(text,groupId,date,wanted){let j;try{j=JSON.parse(text)}catch{return[]}const arr=Array.isArray(j)?j:(Array.isArray(j?.results)?j.results:[]);return arr.filter(x=>wanted.has(Number(x.productId))).map(x=>({product_id:Number(x.productId),group_id:Number(groupId),sub_type_name:String(x.subTypeName||''),low_price:x.lowPrice??null,mid_price:x.midPrice??null,high_price:x.highPrice??null,market_price:x.marketPrice??null,direct_low_price:x.directLowPrice??null,observed_on:date,source_updated_at:new Date().toISOString()})).filter(x=>x.sub_type_name)}
async function download(url,path){const r=await fetch(url,{headers:{'User-Agent':USER_AGENT,Accept:'application/x-7z-compressed,*/*'}});if(r.status===404)return false;if(!r.ok)throw new Error(`TCGCSV ${r.status} for ${url}`);await BunCompatWrite(path,new Uint8Array(await r.arrayBuffer()));return true}
async function BunCompatWrite(path,bytes){const {writeFile}=await import('node:fs/promises');await writeFile(path,bytes)}
async function processDate(job,date,work,wanted){const archive=join(work,`prices-${date}.ppmd.7z`),url=`${TCGCSV_BASE}/archive/tcgplayer/prices-${date}.ppmd.7z`;if(!await download(url,archive))return{date,found:false,rows:0};const extract=join(work,`x-${date}`);const targets=(job.group_ids||[]).map(g=>`${date}/1/${g}/prices`);if(!targets.length)throw new Error('Job has no TCGplayer group ids');await sh('7z',['x','-y',`-o${extract}`,archive,...targets],work);let rows=[];for(const g of job.group_ids||[]){const p=join(extract,date,'1',String(g),'prices');try{rows.push(...rowsFromJson(await readFile(p,'utf8'),g,date,wanted))}catch{}}
for(let i=0;i<rows.length;i+=200)await sb('tcgcsv_tcgplayer_prices?on_conflict=product_id,sub_type_name,observed_on',{method:'POST',body:rows.slice(i,i+200),prefer:'resolution=merge-duplicates,return=minimal'});await rm(archive,{force:true});await rm(extract,{recursive:true,force:true});return{date,found:true,rows:rows.length}}
async function main(){const job=await rpc('claim_delvin_history_backfill_job_v1');if(!job){console.log('No queued Delvin history backfill jobs.');return}const work=await mkdtemp(join(tmpdir(),'delvin-tcgcsv-'));const wanted=new Set((job.product_ids||[]).map(Number));const cutoff=job.coverage_before_start?new Date(`${job.coverage_before_start}T00:00:00Z`):new Date(`${job.desired_end_date}T00:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-1);const end=cutoff<new Date(`${job.desired_end_date}T00:00:00Z`)?iso(cutoff):job.desired_end_date;const sample=dates(job.desired_start_date,end,Number(job.sample_every_days||7));let imported=0,archives=0,missing=0;const started=Date.now();try{for(let i=0;i<sample.length;i++){const r=await processDate(job,sample[i],work,wanted);if(r.found)archives++;else missing++;imported+=r.rows;if(i%5===0)await sb(`delvin_history_backfill_jobs?job_id=eq.${job.job_id}`,{method:'PATCH',body:{progress:{dates_total:sample.length,dates_done:i+1,archives_found:archives,archives_missing:missing,rows_imported:imported,current_date:sample[i]},updated_at:new Date().toISOString()},prefer:'return=minimal'});await sleep(300)}const thesis=await rpc('ask_delvin_collectible_cohort_thesis_v1',{p_treatment:job.treatment,p_set_codes:job.set_codes?.length?job.set_codes:null,p_days:1460});const status=imported>0?'ready':'partial';await rpc('finish_delvin_history_backfill_job_v1',{p_job_id:job.job_id,p_status:status,p_progress:{dates_total:sample.length,dates_done:sample.length,archives_found:archives,archives_missing:missing,rows_imported:imported,duration_seconds:Math.round((Date.now()-started)/1000)},p_result:{thesis,archive_sampling_days:job.sample_every_days,rows_imported:imported},p_error:imported?null:'No matching historical rows were imported.'});console.log(JSON.stringify({job_id:job.job_id,status,dates:sample.length,archives,missing,imported,duration_seconds:Math.round((Date.now()-started)/1000)},null,2))}catch(e){await rpc('finish_delvin_history_backfill_job_v1',{p_job_id:job.job_id,p_status:'failed',p_progress:{dates_total:sample.length,archives_found:archives,archives_missing:missing,rows_imported:imported,duration_seconds:Math.round((Date.now()-started)/1000)},p_result:{},p_error:String(e?.message||e).slice(0,1200)}).catch(()=>{});throw e}finally{await rm(work,{recursive:true,force:true})}}
await main();
