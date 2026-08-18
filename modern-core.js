// Collectish modern product shell — single frontend for desktop and Android WebView
(() => {
  const VERSION='0.9.52';
  const c=window.COLLECTISH_CONFIG;
  const K='collectishSession';
  let refreshInFlight=null;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const H=t=>({apikey:c.publishableKey,Authorization:`Bearer ${t||c.publishableKey}`,'Content-Type':'application/json'});
  const session=()=>{try{return JSON.parse(localStorage.getItem(K)||'null')}catch{return null}};
  const save=s=>s?localStorage.setItem(K,JSON.stringify(s)):localStorage.removeItem(K);
  const brand=()=>'<span class="cx-brand-collect">collect</span><span class="cx-brand-ish">ish</span>';
  const decodeJwt=t=>{try{const p=String(t||'').split('.')[1];if(!p)return null;const s=p.replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(atob(s.padEnd(Math.ceil(s.length/4)*4,'=')))}catch{return null}};
  const serverExp=(token,fallbackSeconds=3600)=>{const p=decodeJwt(token);return p?.exp?Number(p.exp)*1000:Date.now()+Number(fallbackSeconds||3600)*1000};
  const jwtProblem=(status,d,text='')=>{const m=String(d?.message||d?.msg||d?.error_description||d?.error||text||'').toLowerCase();return status===401||m.includes('jwt issued at future')||m.includes('jwt expired')||m.includes('invalid jwt')||m.includes('token is expired')};
  window.COLLECTISH_WEB_VERSION=VERSION;

  async function doRefresh(s=session()){
    if(!s?.refresh){save(null);return null}
    try{
      const r=await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:H(),body:JSON.stringify({refresh_token:s.refresh})});
      const t=await r.text();let d;try{d=t?JSON.parse(t):{}}catch{d={message:t}}
      if(!r.ok||!d?.access_token){save(null);return null}
      const n={token:d.access_token,refresh:d.refresh_token||s.refresh,exp:serverExp(d.access_token,d.expires_in),user:d.user||s.user};
      save(n);return n;
    }catch{save(null);return null}
  }
  async function refreshSession(s=session()){
    if(refreshInFlight)return refreshInFlight;
    refreshInFlight=doRefresh(s).finally(()=>{refreshInFlight=null});
    return refreshInFlight;
  }
  async function valid(){let s=session();if(!s)return null;if(Date.now()<Number(s.exp||0)-60000)return s;return refreshSession(s)}
  window.rest=async function(path,o={}){
    let s=await valid();if(!s)throw Error('Sign in required');
    const request=async token=>{const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{method:o.method||'GET',headers:{...H(token),...(o.prefer?{Prefer:o.prefer}:{})},body:o.body===undefined?undefined:JSON.stringify(o.body)});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}return {r,t,d}};
    let x=await request(s.token);
    if(!x.r.ok&&jwtProblem(x.r.status,x.d,x.t)){
      s=await refreshSession(s);
      if(!s){document.dispatchEvent(new CustomEvent('collectish:auth-invalid'));throw Error('Session expired. Please sign in again.')}
      x=await request(s.token);
    }
    if(!x.r.ok){if(jwtProblem(x.r.status,x.d,x.t)){save(null);document.dispatchEvent(new CustomEvent('collectish:auth-invalid'))}throw Error(x.d?.message||x.d?.msg||`HTTP ${x.r.status}`)}
    return x.d;
  };
  function loginView(message=''){document.body.innerHTML=`<main class="cx-auth"><section class="cx-auth-card"><div class="cx-brand">${brand()}</div><div class="cx-version">web ${VERSION}</div><h1>Sign in</h1><p>Scout opportunities, sealed EV, Seller analytics, SYP changes, inventory, and operations.</p><input id="modernEmail" type="email" autocomplete="email" placeholder="Email"><input id="modernPassword" type="password" autocomplete="current-password" placeholder="Password"><button id="modernSignIn" class="cx-primary">Sign in</button><div id="modernMsg" class="cx-auth-msg">${esc(message)}</div></section></main>`;document.getElementById('modernSignIn').onclick=login;document.getElementById('modernPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login()})}
  async function login(){const email=document.getElementById('modernEmail')?.value.trim(),password=document.getElementById('modernPassword')?.value||'',msg=document.getElementById('modernMsg'),btn=document.getElementById('modernSignIn');if(!email||!password){msg.textContent='Enter email and password.';return}btn.disabled=true;msg.textContent='Signing in…';try{const r=await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=password`,{method:'POST',headers:H(),body:JSON.stringify({email,password})});const d=await r.json();if(!r.ok)throw Error(d.message||'Sign in failed');save({token:d.access_token,refresh:d.refresh_token,exp:serverExp(d.access_token,d.expires_in),user:d.user});boot()}catch(e){btn.disabled=false;msg.textContent=e.message||'Sign in failed'}}
  function adminView(){const h=document.getElementById('cxAdmin');if(!h)return;h.innerHTML=`<div class="cx-page-head"><div><h2>Admin</h2><p>Cloud operations and build identity.</p></div></div><div class="cx-grid"><div class="cx-card cx-span-6"><div class="cx-section-title">Build</div><div class="cx-detail-list"><div class="cx-detail-stat"><span>Web UI</span><strong>${VERSION}</strong></div><div class="cx-detail-stat"><span>Frontend</span><strong>Unified hosted shell</strong></div><div class="cx-detail-stat"><span>Scout source</span><strong>v5 promoted rankings</strong></div></div></div><div class="cx-card cx-span-6"><div class="cx-section-title">Account</div><button id="modernSignOut" class="cx-refresh">Sign out</button></div></div>`;document.getElementById('modernSignOut').onclick=()=>{save(null);loginView()}}
  function switchPage(name){document.querySelectorAll('.cx-page').forEach(x=>x.classList.toggle('active',x.id===`cx${name[0].toUpperCase()+name.slice(1)}`));document.querySelectorAll('[data-cx-page]').forEach(x=>x.classList.toggle('active',x.dataset.cxPage===name));if(name==='admin')adminView();window.scrollTo({top:0,behavior:'smooth'})}
  function shell(){const pages=['scout','sealed','seller','syp','inventory','admin'];const label=k=>k==='syp'?'SYP':k==='sealed'?'Sealed':k[0].toUpperCase()+k.slice(1);document.body.innerHTML=`<div class="cx-top-version">web ${VERSION}</div><main id="app" class="collectish-modern-app"><section id="collectishUxShell" class="collectish-product-shell"><aside class="cx-side"><div class="cx-brand">${brand()}</div><nav class="cx-nav">${pages.map((k,i)=>`<button data-cx-page="${k}" class="${i===0?'active':''}">${label(k)}</button>`).join('')}</nav><div class="cx-side-spacer"></div><div class="cx-side-meta">web ${VERSION}<br>Smarter data. Better decisions.</div></aside><div class="cx-main"><section id="cxScout" class="cx-page active"></section><section id="cxSealed" class="cx-page"></section><section id="cxSeller" class="cx-page"></section><section id="cxSyp" class="cx-page"></section><section id="cxInventory" class="cx-page"></section><section id="cxAdmin" class="cx-page"></section></div><nav class="cx-mobile-nav">${pages.map((k,i)=>`<button data-cx-page="${k}" class="${i===0?'active':''}">${label(k)}</button>`).join('')}</nav></section></main>`;document.addEventListener('click',e=>{const b=e.target.closest('[data-cx-page]');if(b)switchPage(b.dataset.cxPage)},true);adminView()}
  async function boot(){const s=await valid();if(!s){loginView();return}shell();document.dispatchEvent(new CustomEvent('collectish:ready',{detail:{version:VERSION,user:s.user}}))}
  document.addEventListener('collectish:auth-invalid',()=>loginView('Your session was rejected by the server. Please sign in again.'));
  boot();
})();