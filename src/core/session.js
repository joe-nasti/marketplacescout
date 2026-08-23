import { collectishConfig } from './config.js';

const SESSION_KEY='collectishSession';
let refreshInFlight=null;

export function readSession(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}
}

export function saveSession(session){
  if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function decodeJwt(token){
  try{
    const p=String(token||'').split('.')[1];
    if(!p)return null;
    const s=p.replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(atob(s.padEnd(Math.ceil(s.length/4)*4,'=')));
  }catch{return null}
}

export function serverExpiry(token,fallbackSeconds=3600){
  const p=decodeJwt(token);
  return p?.exp?Number(p.exp)*1000:Date.now()+Number(fallbackSeconds||3600)*1000;
}

function headers(token){
  return {
    apikey:collectishConfig.publishableKey,
    Authorization:`Bearer ${token||collectishConfig.publishableKey}`,
    'Content-Type':'application/json'
  };
}

export function isJwtProblem(status,data,text=''){
  const m=String(data?.message||data?.msg||data?.error_description||data?.error||text||'').toLowerCase();
  return status===401||m.includes('jwt issued at future')||m.includes('jwt expired')||m.includes('invalid jwt')||m.includes('token is expired');
}

function refreshRejected(status,data,text=''){
  if(status===400||status===401||status===403)return true;
  const m=String(data?.message||data?.msg||data?.error_description||data?.error||text||'').toLowerCase();
  return m.includes('invalid refresh')||m.includes('refresh token')&&m.includes('invalid')||m.includes('refresh token')&&m.includes('expired');
}

async function doRefresh(session=readSession()){
  if(!session?.refresh){saveSession(null);return null}
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetch(`${collectishConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{
      method:'POST',headers:headers(),body:JSON.stringify({refresh_token:session.refresh}),signal:controller.signal
    });
    const text=await r.text();
    let data;try{data=text?JSON.parse(text):{}}catch{data={message:text}}
    if(!r.ok||!data?.access_token){
      if(refreshRejected(r.status,data,text))saveSession(null);
      document.dispatchEvent(new CustomEvent('collectish:session-refresh-failed',{detail:{status:r.status,rejected:refreshRejected(r.status,data,text)}}));
      return null;
    }
    const next={
      token:data.access_token,
      refresh:data.refresh_token||session.refresh,
      exp:serverExpiry(data.access_token,data.expires_in),
      user:data.user||session.user
    };
    saveSession(next);
    document.dispatchEvent(new CustomEvent('collectish:session-refreshed',{detail:{user:next.user}}));
    return next;
  }catch(error){
    console.warn('Collectish session refresh failed',error);
    // Preserve the saved refresh token on transport/timeout failures so a temporary
    // network problem does not force a sign-in. The next protected request can retry.
    document.dispatchEvent(new CustomEvent('collectish:session-refresh-failed',{detail:{status:0,rejected:false,reason:error?.name||'network'}}));
    return null;
  }finally{clearTimeout(timeout)}
}

export async function refreshSession(session=readSession()){
  if(refreshInFlight)return refreshInFlight;
  refreshInFlight=doRefresh(session).finally(()=>{refreshInFlight=null});
  return refreshInFlight;
}

export async function validSession(){
  const session=readSession();
  if(!session)return null;
  if(Date.now()<Number(session.exp||0)-60000)return session;
  return refreshSession(session);
}

export async function signIn(email,password){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(`${collectishConfig.supabaseUrl}/auth/v1/token?grant_type=password`,{
      method:'POST',headers:headers(),body:JSON.stringify({email,password}),signal:controller.signal
    });
    const text=await r.text();
    let data;try{data=text?JSON.parse(text):{}}catch{data={message:text}}
    if(!r.ok||!data?.access_token)throw new Error(data?.message||'Sign in failed');
    const session={token:data.access_token,refresh:data.refresh_token,exp:serverExpiry(data.access_token,data.expires_in),user:data.user};
    saveSession(session);
    return session;
  }finally{clearTimeout(timeout)}
}

export function signOut(){
  saveSession(null);
  document.dispatchEvent(new CustomEvent('collectish:auth-invalid'));
}

export { SESSION_KEY };
