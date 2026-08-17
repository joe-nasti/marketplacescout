// Collectish Scout bootstrap — load the Scout renderer only after the app shell exists.
// This avoids the renderer's legacy pre-shell MutationObserver fallback entirely.
(() => {
  let started=false;
  function start(){
    if(started||!document.getElementById('cxScout'))return;
    started=true;
    const s=document.createElement('script');
    s.src='current-scout-v5-promoted.js?v=0963';
    s.async=false;
    s.dataset.cxScoutBootstrap='safe';
    s.onerror=()=>{
      started=false;
      const h=document.getElementById('cxScout');
      if(h)h.innerHTML='<div class="cx-empty">Scout failed to load. Tap Scout to retry.</div>';
    };
    document.body.append(s);
  }
  document.addEventListener('collectish:ready',()=>queueMicrotask(start),{once:true});
  document.addEventListener('click',e=>{
    if(e.target?.closest?.('[data-cx-page="scout"]'))setTimeout(start,0);
  },true);
  // Shell may already exist when this script is cache-reloaded.
  if(document.getElementById('cxScout'))queueMicrotask(start);
  window.CollectishScoutBootstrap={start};
})();