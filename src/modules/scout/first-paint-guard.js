let installed=false;

function hasUsefulScoutContent(host){
  return Boolean(host?.querySelector('.cx-scout-card, #cxParityCards, .cx-scout-layout, [data-scout-saved]'));
}

export function installScoutFirstPaintGuard(){
  if(installed)return;
  const host=document.getElementById('cxScout');
  if(!host||!hasUsefulScoutContent(host))return;
  const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  if(!descriptor?.get||!descriptor?.set)return;
  installed=true;

  let released=false;
  const release=()=>{
    if(released)return;
    released=true;
    delete host.innerHTML;
    document.removeEventListener('collectish:scout-v5-ready',release);
    clearTimeout(timeout);
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

  document.addEventListener('collectish:scout-v5-ready',release,{once:true});
  const timeout=setTimeout(release,15000);
}

installScoutFirstPaintGuard();
