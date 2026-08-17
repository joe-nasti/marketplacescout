// Collectish app theme — persistent Light / Dark / System support.
(() => {
  const KEY='collectishTheme';
  const MODES=['system','light','dark'];
  const mq=matchMedia('(prefers-color-scheme: dark)');
  const saved=()=>{const v=localStorage.getItem(KEY);return MODES.includes(v)?v:'system'};
  const resolved=m=>m==='system'?(mq.matches?'dark':'light'):m;
  function syncNative(theme){try{window.CollectishAndroid?.setTheme?.(theme)}catch{}}
  function apply(mode=saved()){
    const theme=resolved(mode);
    document.documentElement.dataset.cxTheme=theme;
    document.documentElement.dataset.cxThemeMode=mode;
    document.documentElement.style.colorScheme=theme;
    document.documentElement.style.backgroundColor=theme==='dark'?'#0b1220':'#f5f8fc';
    if(document.body)document.body.style.backgroundColor=theme==='dark'?'#0b1220':'#f5f8fc';
    const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==='dark'?'#0b1220':'#f5f8fc';
    syncNative(theme);
    document.querySelectorAll('[data-cx-theme-toggle]').forEach(b=>{b.textContent=mode==='system'?'◐':mode==='dark'?'☾':'☀';b.title=`Theme: ${mode}. Tap to change.`;b.setAttribute('aria-label',`Theme: ${mode}. Tap to change.`)});
  }
  function cycle(){const cur=saved(),next=MODES[(MODES.indexOf(cur)+1)%MODES.length];localStorage.setItem(KEY,next);apply(next)}
  function addToggle(){
    if(document.querySelector('[data-cx-theme-toggle]'))return;
    const b=document.createElement('button');b.type='button';b.className='cx-theme-toggle';b.dataset.cxThemeToggle='1';b.onclick=cycle;document.body.append(b);apply();
  }
  apply();mq.addEventListener?.('change',()=>{if(saved()==='system')apply('system')});
  window.addEventListener('pageshow',()=>apply());document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
  document.addEventListener('collectish:ready',()=>setTimeout(addToggle,0));
  new MutationObserver(()=>{if(document.body&&document.querySelector('#collectishUxShell'))addToggle()}).observe(document.documentElement,{childList:true,subtree:true});
})();
