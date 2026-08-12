// Collectish web v0.5.1 — Supabase project-user password recovery
(() => {
  const el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent="web v0.5.1"};
  setBadge();setTimeout(setBadge,600);setTimeout(setBadge,3000);
  if(!document.querySelector('link[data-collectish-v051]')){
    const l=document.createElement("link");l.rel="stylesheet";l.href="v051.css?v=051";l.dataset.collectishV051="1";document.head.appendChild(l);
  }

  function ensureRecoveryUi(){
    const login=el("login");if(!login||el("forgotPassword"))return false;
    const grid=login.querySelector(".grid");
    const forgot=document.createElement("button");
    forgot.id="forgotPassword";forgot.type="button";forgot.className="collectish-forgot";forgot.textContent="Forgot password?";
    grid?.insertAdjacentElement("afterend",forgot);

    const panel=document.createElement("div");
    panel.id="passwordRecoveryPanel";panel.className="password-recovery-panel";panel.hidden=true;
    panel.innerHTML=`
      <div id="passwordRecoveryRequest" class="password-recovery-step">
        <h3>Reset Collectish password</h3>
        <p class="meta">We'll send a reset link to the Supabase project user email used by Collectish.</p>
        <div class="password-recovery-row"><input id="recoveryEmail" type="email" placeholder="Email"><button id="sendRecoveryEmail" type="button" class="primary">Send reset email</button></div>
      </div>
      <div id="passwordRecoverySet" class="password-recovery-step" hidden>
        <h3>Choose a new password</h3>
        <p class="meta">This changes only the Collectish Supabase Auth user password, not your Supabase dashboard or database password.</p>
        <div class="password-recovery-row"><input id="newRecoveryPassword" type="password" autocomplete="new-password" placeholder="New password"><input id="confirmRecoveryPassword" type="password" autocomplete="new-password" placeholder="Confirm password"><button id="saveRecoveryPassword" type="button" class="primary">Set new password</button></div>
      </div>
      <div id="passwordRecoveryMsg" class="meta password-recovery-message"></div>`;
    login.appendChild(panel);

    forgot.addEventListener("click",()=>{
      panel.hidden=!panel.hidden;
      const email=el("email")?.value||"";if(email)el("recoveryEmail").value=email;
    });
    el("sendRecoveryEmail").addEventListener("click",sendRecovery);
    el("saveRecoveryPassword").addEventListener("click",saveNewPassword);
    return true;
  }

  async function sendRecovery(){
    const email=(el("recoveryEmail")?.value||el("email")?.value||"").trim();
    const msg=el("passwordRecoveryMsg");
    if(!email){msg.textContent="Enter the Collectish account email first.";return}
    msg.textContent="Sending reset email…";
    const redirectTo=location.origin+location.pathname;
    try{
      const r=await fetch(`${c.supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,{
        method:"POST",headers:H(),body:JSON.stringify({email})
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(d?.msg||d?.message||`Reset request failed (HTTP ${r.status})`);
      msg.textContent=`Reset email sent to ${email}. Open the link in that email on this device.`;
    }catch(e){msg.textContent=e.message}
  }

  function recoveryHash(){
    const h=new URLSearchParams(location.hash.replace(/^#/,""));
    return {
      type:h.get("type"),token:h.get("access_token"),refresh:h.get("refresh_token"),
      expiresIn:Number(h.get("expires_in")||3600),error:h.get("error_description")||h.get("error")
    };
  }

  async function activateRecoveryIfPresent(){
    const h=recoveryHash();
    if(h.error){
      ensureRecoveryUi();el("passwordRecoveryPanel").hidden=false;el("passwordRecoveryMsg").textContent=decodeURIComponent(h.error);return;
    }
    if(h.type!=="recovery"||!h.token)return;
    ensureRecoveryUi();
    el("login").hidden=false;el("passwordRecoveryPanel").hidden=false;
    el("passwordRecoveryRequest").hidden=true;el("passwordRecoverySet").hidden=false;
    el("passwordRecoveryPanel").dataset.recoveryToken=h.token;
    el("passwordRecoveryPanel").dataset.refreshToken=h.refresh||"";
    el("passwordRecoveryPanel").dataset.expiresIn=String(h.expiresIn||3600);
    el("passwordRecoveryMsg").textContent="Recovery link accepted. Choose a new password.";
  }

  async function saveNewPassword(){
    const p=el("newRecoveryPassword")?.value||"",confirm=el("confirmRecoveryPassword")?.value||"";
    const msg=el("passwordRecoveryMsg"),panel=el("passwordRecoveryPanel");
    if(p.length<8){msg.textContent="Use at least 8 characters.";return}
    if(p!==confirm){msg.textContent="The two passwords don't match.";return}
    const token=panel?.dataset.recoveryToken;if(!token){msg.textContent="Recovery session is missing. Request a new reset email.";return}
    msg.textContent="Updating password…";
    try{
      const r=await fetch(`${c.supabaseUrl}/auth/v1/user`,{
        method:"PUT",headers:{...H(token),Authorization:`Bearer ${token}`},body:JSON.stringify({password:p})
      });
      const user=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(user?.msg||user?.message||`Password update failed (HTTP ${r.status})`);
      const refresh=panel.dataset.refreshToken||null,expiresIn=Number(panel.dataset.expiresIn||3600);
      if(refresh)save({token,refresh,exp:Date.now()+expiresIn*1000,user});
      history.replaceState(null,"",location.pathname+location.search);
      el("newRecoveryPassword").value="";el("confirmRecoveryPassword").value="";
      msg.textContent="Password updated. You can now sign in with the new password.";
      el("passwordRecoverySet").hidden=true;el("passwordRecoveryRequest").hidden=false;
      if(user?.email)el("email").value=user.email;
    }catch(e){msg.textContent=e.message}
  }

  let tries=0;const t=setInterval(()=>{
    tries++;
    if(ensureRecoveryUi())activateRecoveryIfPresent();
    else if(el("forgotPassword")){activateRecoveryIfPresent();clearInterval(t)}
    if(tries>100)clearInterval(t);
  },100);
})();
