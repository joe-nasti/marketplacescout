// Collectish web v0.5.2 — unified shell dark-mode contrast + version pin
(() => {
  const setBadge=()=>{const b=document.getElementById("appVersion");if(b)b.textContent="web v0.5.2"};
  setBadge();
  [300,900,3200,5000].forEach(ms=>setTimeout(setBadge,ms));
  if(!document.querySelector('link[data-collectish-v052]')){
    const l=document.createElement("link");
    l.rel="stylesheet";
    l.href="v052.css?v=052";
    l.dataset.collectishV052="1";
    document.head.appendChild(l);
  }
})();
