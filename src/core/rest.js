import { collectishConfig } from './config.js';
import { validSession, refreshSession, isJwtProblem } from './session.js';
import store from '../state/store.js';
import { loadResource } from '../state/resources.js';
import { resourceContractForPath } from '../state/route-data-contracts.js';

const METRIC_KEY='collectishRuntimeHealth';
const ENDPOINT_STAT_LIMIT=24;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function readMetrics(){try{return JSON.parse(sessionStorage.getItem(METRIC_KEY)||'{}')}catch{return {}}}
function bump(key,extra={}){const m=readMetrics();m[key]=Number(m[key]||0)+1;m.last_event_at=new Date().toISOString();Object.assign(m,extra);try{sessionStorage.setItem(METRIC_KEY,JSON.stringify(m))}catch{};document.dispatchEvent(new CustomEvent('collectish:runtime-health',{detail:{...m,event:key}}))}
function headers(token,prefer){return {apikey:collectishConfig.publishableKey,Authorization:`Bearer ${token||collectishConfig.publishableKey}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})}}
function resourceKey(path){return `supabase:${String(path)}`}
function writeResource(path,patch){const key=resourceKey(path),resources=store.get().resources||{},current=resources[key]||{};store.update('resources',{[key]:{...current,...patch}})}
function endpointKey(path){const base=String(path||'').split('?')[0].replace(/^\/+/, '');if(!base)return'unknown';return base.startsWith('rpc/')?base:base.split('/')[0]}
function responseBytes(response,text){const header=Number(response?.headers?.get?.('content-length')||0);if(Number.isFinite(header)&&header>0)return header;try{return new TextEncoder().encode(text||'').byteLength}catch{return String(text||'').length}}
function recordEndpoint(path,{elapsedMs,status,bytes,method,error=false}){
  const m=readMetrics(),key=endpointKey(path),stats={...(m.rest_endpoint_stats||{})},old=stats[key]||{};
  const count=Number(old.count||0)+1,totalMs=Number(old.totalMs||0)+Number(elapsedMs||0),errors=Number(old.errors||0)+(error?1:0),totalBytes=Number(old.bytes||0)+Number(bytes||0);
  stats[key]={count,totalMs:Math.round(totalMs),maxMs:Math.max(Number(old.maxMs||0),Number(elapsedMs||0)),lastMs:Math.round(Number(elapsedMs||0)),errors,bytes:Math.round(totalBytes),lastStatus:Number(status||0),lastMethod:String(method||'GET'),lastAt:new Date().toISOString()};
  const ordered=Object.entries(stats).sort((a,b)=>Number(b[1]?.totalMs||0)-Number(a[1]?.totalMs||0)).slice(0,ENDPOINT_STAT_LIMIT);
  m.rest_endpoint_stats=Object.fromEntries(ordered);
  m.rest_request_count=Number(m.rest_request_count||0)+1;
  m.rest_transfer_bytes=Number(m.rest_transfer_bytes||0)+Number(bytes||0);
  if(error)m.rest_error_count=Number(m.rest_error_count||0)+1;
  m.last_rest_endpoint=key;m.last_rest_ms=Math.round(Number(elapsedMs||0));m.last_event_at=new Date().toISOString();
  try{sessionStorage.setItem(METRIC_KEY,JSON.stringify(m))}catch{}
  document.dispatchEvent(new CustomEvent('collectish:runtime-health',{detail:{event:'rest-endpoint',endpoint:key,elapsedMs:Math.round(Number(elapsedMs||0)),status:Number(status||0)}}));
}

async function request(path,options,token){
  const method=String(options.method||'GET').toUpperCase(),started=performance.now();
  try{
    const r=await fetch(`${collectishConfig.supabaseUrl}/rest/v1/${path}`,{method,headers:headers(token,options.prefer),body:options.body===undefined?undefined:JSON.stringify(options.body)});
    const text=await r.text();let data;try{data=text?JSON.parse(text):null}catch{data=text};
    recordEndpoint(path,{elapsedMs:performance.now()-started,status:r.status,bytes:responseBytes(r,text),method,error:!r.ok});
    return {r,text,data};
  }catch(error){
    recordEndpoint(path,{elapsedMs:performance.now()-started,status:0,bytes:0,method,error:true});
    throw error;
  }
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
  const contract=method==='GET'&&!options.__routeResource?resourceContractForPath(path):null;
  if(contract){
    const nested={...options,__routeResource:true};
    delete nested.force;
    return loadResource(contract.key,()=>rest(path,nested),{
      force:Boolean(options.force),
      ttl:Number(contract.ttl??30000),
      persistent:true,
      scope:'user',
      staleWhileRevalidate:true,
      maxStale:Number(contract.maxStale??7*24*60*60*1000)
    });
  }
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
