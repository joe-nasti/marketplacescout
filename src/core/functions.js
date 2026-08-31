import { collectishConfig } from './config.js';
import { validSession, refreshSession, isJwtProblem } from './session.js';

function headers(token){
  return {
    apikey:collectishConfig.publishableKey,
    Authorization:`Bearer ${token||collectishConfig.publishableKey}`,
    'Content-Type':'application/json'
  };
}

async function requestFunction(name,body,session){
  const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/${encodeURIComponent(name)}`,{
    method:'POST',
    headers:headers(session?.token),
    body:JSON.stringify(body??{})
  });
  const text=await r.text();
  let data;try{data=text?JSON.parse(text):null}catch{data=text}
  return {r,text,data};
}

export async function invokeFunction(name,body={}){
  let session=await validSession();
  if(!session)throw new Error('Sign in required');
  let out=await requestFunction(name,body,session);
  if(!out.r.ok&&isJwtProblem(out.r.status,out.data,out.text)){
    session=await refreshSession(session);
    if(!session){
      document.dispatchEvent(new CustomEvent('collectish:auth-invalid'));
      throw new Error('Session expired. Please sign in again.');
    }
    out=await requestFunction(name,body,session);
  }
  if(!out.r.ok){
    if(isJwtProblem(out.r.status,out.data,out.text))document.dispatchEvent(new CustomEvent('collectish:auth-invalid'));
    throw new Error(out.data?.error||out.data?.message||`Function ${name} HTTP ${out.r.status}`);
  }
  return out.data;
}

export function installFunctionBridge(){
  window.CollectishApi={...(window.CollectishApi||{}),invokeFunction};
}
