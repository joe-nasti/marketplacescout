let installed=false;

function hasUsefulScoutContent(host){
  return Boolean(host?.querySelector('.cx-scout-card, #cxParityCards, .cx-scout-layout, [data-scout-saved]'));
}
function finalMobileSurfaceReady(host){
  return Boolean(host?.querySelector('#cxScoutIa')&&host?.querySelector('#cxScoutFilterSheet')&&host?.querySelector('#cxParityCards.cx-scout-dense-list'));
}

export function installScoutFirstPaintGuard(){
  if(installed)return;
  const host=document.getElementById('cxScout');
  if(!host)return;
  installed=true;

  const usefulContentAtInstall=hasUsefulScoutContent(host);
  const mobile=matchMedia('(max-width:700px)').matches;
  let paintReleased=!mobile;
  let paintTimeout=0;
  const releasePaint=()=>{
    if(paintReleased)return;
    paintReleased=true;
    host.classList.remove('cx-scout-preparing');
    if(paintTimeout)clearTimeout(paintTimeout);
  };
  if(mobile&&usefulContentAtInstall){
    host.classList.add('cx-scout-preparing');
    const started=performance.now();
    const waitForFinal=()=>{
      if(paintReleased)return;
      if(finalMobileSurfaceReady(host)){releasePaint();return}
      if(performance.now()-started<3000)requestAnimationFrame(waitForFinal);
    };
    requestAnimationFrame(waitForFinal);
    paintTimeout=setTimeout(releasePaint,3200);
  }

  if(!usefulContentAtInstall)return;
  const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  if(!descriptor?.get||!descriptor?.set)return;
  let released=false;
  let timeout=0;
  const releaseInnerGuard=()=>{
    if(released)return;
    released=true;
    delete host.innerHTML;
    document.removeEventListener('collectish:scout-v5-ready',releaseInnerGuard);
    if(timeout)clearTimeout(timeout);
  };

  Object.defineProperty(host,'innerHTML',{
    configurable:true,
    get(){return descriptor.get.call(this)},
    set(value){
      const html=String(value??'');
      const destructiveLoading=html.includes('Loading Scout v5')||html.includes('Finding the strongest buying and speculation opportunities');
      if(!released&&destructiveLoading&&hasUsefulScoutContent(this)){
        this.dataset.scoutFirstPaintHeld='true';
        return;
      }
      descriptor.set.call(this,value);
    }
  });

  document.addEventListener('collectish:scout-v5-ready',releaseInnerGuard,{once:true});
  timeout=setTimeout(releaseInnerGuard,15000);
}

installScoutFirstPaintGuard();
