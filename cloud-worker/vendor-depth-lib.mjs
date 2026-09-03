import {createHash} from 'node:crypto';

export const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
export const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
export const BATCH=Math.max(50,Math.min(1000,Number(process.env.VENDOR_DEPTH_BATCH_SIZE||500)));
export const now=()=>new Date().toISOString();
export const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const money=value=>value==null||value===''?null:Math.round(Number(value)*100)/100;
export const qty=value=>value==null||value===''?null:Math.max(0,Math.trunc(Number(value)));

export async function rest(path,{method='GET',body,prefer}={}){
  if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const headers={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
  if(prefer)headers.Prefer=prefer;
  let last;
  for(let attempt=0;attempt<5;attempt++){
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const raw=await response.text();
    if(response.ok){try{return raw?JSON.parse(raw):null}catch{return raw}}
    last=new Error(`Supabase ${response.status}: ${raw.slice(0,500)}`);
    if(![429,500,502,503,504].includes(response.status))throw last;
    await new Promise(resolve=>setTimeout(resolve,500*(2**attempt)));
  }
  throw last;
}

export async function upsert(table,rows,conflict){
  let written=0;
  for(let i=0;i<rows.length;i+=BATCH){
    const part=rows.slice(i,i+BATCH);
    await rest(`${table}?on_conflict=${encodeURIComponent(conflict)}`,{method:'POST',body:part,prefer:'resolution=merge-duplicates,return=minimal'});
    written+=part.length;
    if(written%10000<BATCH)console.log(`${table}: ${written}/${rows.length}`);
  }
  return written;
}

export function observation(base){
  const material={price:base.price,quantity:base.quantity,listing_count:base.listing_count,threshold_price:base.threshold_price,
    measurement_scope:base.measurement_scope,count_quality:base.count_quality,is_executable:base.is_executable,detail:base.detail||{}};
  return {...base,value_hash:sha(material)};
}

export async function beginRun(source,endpoint,observedAt,detail={}){
  const result=await rest('vendor_depth_runs',{method:'POST',body:[{source,endpoint,observed_at:observedAt,started_at:observedAt,detail}],prefer:'return=representation'});
  return result[0];
}

export async function finishRun(id,patch){
  await rest(`vendor_depth_runs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{...patch,completed_at:now()},prefer:'return=minimal'});
}

