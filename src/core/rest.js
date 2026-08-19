import { collectishConfig } from './config.js';
import { validSession, refreshSession, isJwtProblem } from './session.js';
import store from '../state/store.js';

const METRIC_KEY='collectishRuntimeHealth';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function readMetrics(){try{return JSON.parse(sessionStorage.getItem(METRIC_KEY)||'{}')}catch{return {}}}
function bump(key,extra={}){const m=readMetrics();m[key]=Number(m[key]||0)+1;m.last_event_at=new Date().toISOString();Object.assign(m,extra);try{sessionStorage.setItem(METRIC_KEY,JSON.stringify(m))}catch{};document.dispatchEvent(new CustomEvent('collectish:runtime-health',{detail:{...m,event:key}}))}
function headers(token,prefer){return {apikey:collectishConfig.publishableKey,Authorization:`Bearer ${token||collectishConfig.publishableKey}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})}}
function resourceKey(path){return `supabase:${String(path)}`}
function writeResource(path,patch){const key=resourceKey(path),resources=store.get().resources||{},current=resources[key]||{};store.update('resources',{[key]:{...current,...patch}})}

async function request(path,options,token){
  const r=await fetch(`${collectishConfig.supabaseUrl}/rest/v1/${path}`,{method:options.method||'GET',headers:headers(token,options.prefer),body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const text=await r.text();let data;try{data=text?JSON.parse(text):null}catch{data=text};return {r,text,data};
}

async function baseRest(path,options={}){
  let session=await validSession();
  if(!session)throw new Error('Sign in required');
  let out=await request(path,options,session.token);
  if(!out.r.ok&&isJwtProblem(out.r.status,out.data,out.text)){
    session=await refreshSession(session);
    if(!session){document.dispatchEvent(new CustomEvent('collectish:auth-invalid'));throw new Error('Session expired. Please sign in again.')}
    out=await request(path,options,session.token);
  }
  if(!out.r.ok){if(isJwtProblem(out.r.status,out.data,out.text))document.dispatchEvent(new CustomEvent('collectish:auth-invalid'));throw new Error(out.data?.message||out.data?.msg||`HTTP ${out.r.status}`)}
  return out.data;
}

function isTimeout(error){return String(error?.message||error||'').toLowerCase().includes('statement timeout')}
function largeLimit(path){const m=String(path).match(/(?:^|[?&])limit=(\d+)/);const n=m?Number(m[1]):0;return Number.isFinite(n)&&n>1000?n:0}
function pagedPath(path,limit,offset){
  let s=String(path);
  s=s.replace(/([?&])limit=\d+/,`$1limit=${limit}`);
  if(/(?:^|[?&])offset=\d+/.test(s))s=s.replace(/([?&])offset=\d+/,`$1offset=${offset}`);
  else s+=`${s.includes('?')?'&':'?'}offset=${offset}`;
  return s;
}
async function baseRestLarge(path,options,requestedLimit){
  const out=[];const pageSize=1000;
  for(let offset=0;offset<requestedLimit;offset+=pageSize){
    const take=Math.min(pageSize,requestedLimit-offset);
    const page=await baseRest(pagedPath(path,take,offset),options);
    if(!Array.isArray(page))return page;
    out.push(...page);
    if(page.length<take)break;
  }
  return out;
}

export async function rest(path,options={}){
  const method=String(options?.method||'GET').toUpperCase();
  const requestedLimit=method==='GET'?largeLimit(path):0;
  const started=performance.now();
  if(method==='GET')writeResource(path,{status:'loading',error:null,requestedAt:Date.now()});
  const execute=()=>requestedLimit?baseRestLarge(path,options,requestedLimit):baseRest(path,options);
  try{
    const out=await execute();
    const elapsed=Math.round(performance.now()-started);
    if(method==='GET')writeResource(path,{status:'ready',data:out,error:null,fetchedAt:Date.now(),elapsedMs:elapsed,paged:requestedLimit>0});
    if(elapsed>4000)bump('slow_reads',{last_slow_read_ms:elapsed,last_slow_read_path:String(path).slice(0,180)});
    return out;
  }catch(error){
    if(method!=='GET'||!isTimeout(error)){
      if(method==='GET')writeResource(path,{status:'error',error:String(error?.message||error),failedAt:Date.now()});
      throw error;
    }
    bump('statement_timeout_retries',{last_retry_path:String(path).slice(0,180)});
    await sleep(350+Math.floor(Math.random()*250));
    const retryStarted=performance.now();
    try{
      const out=await execute();
      const elapsed=Math.round(performance.now()-retryStarted);
      writeResource(path,{status:'ready',data:out,error:null,fetchedAt:Date.now(),elapsedMs:elapsed,retried:true,paged:requestedLimit>0});
      bump('statement_timeout_recoveries',{last_retry_ms:elapsed});
      return out;
    }catch(second){
      writeResource(path,{status:'error',error:String(second?.message||second),failedAt:Date.now(),retried:true});
      if(isTimeout(second))bump('statement_timeout_failures',{last_failure_path:String(path).slice(0,180)});
      throw second;
    }
  }
}

export function installRestBridge(){rest.__cxReadRetry=true;window.rest=rest;window.CollectishRuntimeHealth={get:readMetrics};window.CollectishApi={rest}}
export { readMetrics, resourceKey };
