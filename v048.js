// Collectish Marketplace Scout web v0.4.8 — System / Light / Dark theme
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.4.8";
  const KEY="collectishThemeModeV1";
  const valid=m=>["system","light","dark"].includes(m)?m:"system";
  const effective=m=>m==="dark"?"dark":m==="light"?"light":window.matchMedia?.("(prefers-color-scheme: dark)")?.matches?"dark":"light";
  function apply(mode){
    mode=valid(mode);const e=effective(mode);
    document.documentElement.dataset.theme=e;
    document.documentElement.dataset.themeMode=mode;
    document.documentElement.style.colorScheme=e;
    const s=el("mobileThemeMode");if(s&&s.value!==mode)s.value=mode;
  }
  function ensureControl(){
    const settings=el("mobileSettingsCard");if(!settings||el("mobileThemeMode"))return false;
    const wrap=document.createElement("div");wrap.className="mobile-theme-setting";
    wrap.innerHTML='<label>Appearance<select id="mobileThemeMode"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><div class="meta">System follows your device preference. Card artwork is never inverted.</div>';
    const signout=el("mobileSignOutMirror");settings.insertBefore(wrap,signout||null);
    const select=el("mobileThemeMode");select.value=valid(localStorage.getItem(KEY)||"system");select.addEventListener("change",()=>{localStorage.setItem(KEY,select.value);apply(select.value)});
    return true;
  }
  apply(localStorage.getItem(KEY)||"system");
  const mq=window.matchMedia?.("(prefers-color-scheme: dark)");mq?.addEventListener?.("change",()=>{if((document.documentElement.dataset.themeMode||"system")==="system")apply("system")});
  let tries=0;const t=setInterval(()=>{tries++;if(ensureControl()||tries>80)clearInterval(t)},250);
})();
