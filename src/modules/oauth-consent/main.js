import { collectishConfig } from '../../core/config.js';
import { signIn, validSession } from '../../core/session.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function authHeaders(token){
  return {
    apikey:collectishConfig.publishableKey,
    Authorization:`Bearer ${token}`,
    'Content-Type':'application/json'
  };
}
function shell(inner){
  document.body.innerHTML=`<main class="cx-auth cx-oauth-consent"><section class="cx-auth-card" style="max-width:540px"><div class="cx-brand"><span class="cx-brand-collect">collect</span><span class="cx-brand-ish">ish</span></div>${inner}</section></main>`;
}
function errorMessage(error){return String(error?.message||error||'Unknown authorization error').slice(0,500)}

async function oauthRequest(authorizationId,session,action='details'){
  const base=`${collectishConfig.supabaseUrl}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}`;
  const response=await fetch(action==='details'?base:`${base}/consent`,{
    method:action==='details'?'GET':'POST',
    headers:authHeaders(session.token),
    ...(action==='details'?{}:{body:JSON.stringify({action})})
  });
  const text=await response.text();
  let data;try{data=text?JSON.parse(text):{}}catch{data={message:text}}
  if(!response.ok)throw new Error(data?.message||data?.error_description||data?.error||`Authorization failed (${response.status})`);
  return data;
}

async function renderSignIn(authorizationId){
  shell(`<h1>Sign in to link Discord</h1><p>Use your Collectish account to continue the Discord connection.</p><form id="cxOauthLogin" class="cx-auth-form"><label>Email<input id="cxOauthEmail" type="email" autocomplete="email" required></label><label>Password<input id="cxOauthPassword" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button><small id="cxOauthLoginError" style="display:block"></small></form>`);
  const form=document.getElementById('cxOauthLogin');
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=form.querySelector('button');
    const out=document.getElementById('cxOauthLoginError');
    if(button)button.disabled=true;if(out)out.textContent='';
    try{
      const session=await signIn(document.getElementById('cxOauthEmail')?.value,document.getElementById('cxOauthPassword')?.value);
      await renderConsent(authorizationId,session);
    }catch(error){if(out)out.textContent=errorMessage(error)}finally{if(button)button.disabled=false}
  });
}

async function renderConsent(authorizationId,session){
  const details=await oauthRequest(authorizationId,session);
  if(details?.redirect_url&&!details?.authorization_id){location.replace(details.redirect_url);return}
  const clientName=details?.client?.name||'Collectish Discord';
  const scopes=String(details?.scope||'').split(/\s+/).filter(Boolean);
  shell(`<h1>Connect ${esc(clientName)}?</h1><p>This lets the Collectish Discord application call <strong>Ask Collectish as your account</strong>, using the same permissions and Row Level Security as the web app.</p><div class="cx-oauth-summary" style="margin:18px 0;padding:14px;border:1px solid var(--border,#333);border-radius:12px"><div><strong>Application</strong><br>${esc(clientName)}</div>${scopes.length?`<div style="margin-top:12px"><strong>Identity scopes</strong><br>${scopes.map(esc).join(' · ')}</div>`:''}<p style="margin-bottom:0">Discord server members do not receive access to your Collectish account. The bot uses this authorization only when handling your requests.</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button id="cxOauthApprove" type="button">Connect Discord</button><button id="cxOauthDeny" type="button" class="cx-secondary">Cancel</button></div><small id="cxOauthError" style="display:block;margin-top:12px"></small>`);
  const out=document.getElementById('cxOauthError');
  const decide=async action=>{
    const approve=document.getElementById('cxOauthApprove'),deny=document.getElementById('cxOauthDeny');
    if(approve)approve.disabled=true;if(deny)deny.disabled=true;if(out)out.textContent='';
    try{
      const result=await oauthRequest(authorizationId,session,action);
      if(!result?.redirect_url)throw new Error('Authorization did not return a redirect URL');
      location.assign(result.redirect_url);
    }catch(error){if(out)out.textContent=errorMessage(error);if(approve)approve.disabled=false;if(deny)deny.disabled=false}
  };
  document.getElementById('cxOauthApprove')?.addEventListener('click',()=>decide('approve'));
  document.getElementById('cxOauthDeny')?.addEventListener('click',()=>decide('deny'));
}

export async function startOAuthConsent(){
  const authorizationId=new URLSearchParams(location.search).get('authorization_id');
  if(!authorizationId){shell('<h1>Invalid authorization request</h1><p>No authorization ID was provided. Return to Discord and run <code>/ask</code> again.</p>');return}
  try{
    const session=await validSession();
    if(!session){await renderSignIn(authorizationId);return}
    await renderConsent(authorizationId,session);
  }catch(error){shell(`<h1>Could not authorize Discord</h1><p>${esc(errorMessage(error))}</p><p>Return to Discord and run <code>/ask</code> again.</p>`)}
}
