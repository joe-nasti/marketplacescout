// Collectish web v0.5.3 — dark-mode cleanup + durable version badge
(() => {
  const setBadge=()=>{const b=document.getElementById('appVersion');if(b&&b.textContent!=='web v0.5.3')b.textContent='web v0.5.3'};
  setBadge();
  if(!document.querySelector('link[data-collectish-v053]')){
    const l=document.createElement('link');
    l.rel='stylesheet';
    l.href='v053.css?v=053';
    l.dataset.collectishV053='1';
    document.head.appendChild(l);
  }
  // Older additive overlays still write to the badge. Observe only this element so
  // the visible version always reflects the newest loaded overlay without touching app DOM.
  const badge=document.getElementById('appVersion');
  if(badge&&!badge.dataset.collectishVersionGuard){
    badge.dataset.collectishVersionGuard='1';
    new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
  }
  [250,750,1500,3000,6000].forEach(ms=>setTimeout(setBadge,ms));
})();
