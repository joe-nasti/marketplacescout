let installed=false;

function hasUsefulScoutContent(host){
  return Boolean(host?.querySelector('.cx-scout-card, #cxParityCards, .cx-scout-layout, [data-scout-saved]'));
}

export function installScoutFirstPaintGuard(){
  if(installed)return;
  const host=document.getElementById('cxScout');
  if(!host||!hasUsefulScoutContent(host))return;
  installed=true;

  const preserved=[...host.childNodes];
  let released=false;
  const release=()=>{
    if(released)return;
    released=true;
    observer.disconnect();
    document.removeEventListener('collectish:scout-v5-ready',release);
    clearTimeout(timeout);
  };

  const observer=new MutationObserver(()=>{
    if(released||!host.isConnected)return;
    const text=host.textContent||'';
    const destructiveLoading=text.includes('Loading Scout v5')||text.includes('Finding the strongest buying and speculation opportunities');
    const hasCurrentCards=Boolean(host.querySelector('.cx-scout-card, #cxParityCards'));
    if(destructiveLoading&&!hasCurrentCards){
      host.replaceChildren(...preserved);
      host.dataset.scoutFirstPaintHeld='true';
    }
  });

  observer.observe(host,{childList:true,subtree:true});
  document.addEventListener('collectish:scout-v5-ready',release,{once:true});
  const timeout=setTimeout(release,15000);
}

installScoutFirstPaintGuard();
