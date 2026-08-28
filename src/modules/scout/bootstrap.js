import { registerComponent } from '../../core/lifecycle.js';
import store from '../../state/store.js';

let started=false;
let loading=null;
let signalFastOpenLoading=null;

export async function startScout(){
  if(started)return;
  if(loading)return loading;
  const host=document.getElementById('cxScout');
  if(!host)return;
  loading=(async()=>{
    try{
      const module=await import('./index.js');
      await module.installScoutRenderer();
      started=true;
    }catch(error){
      started=false;
      host.innerHTML='<div class="cx-empty">Scout failed to load. Reopen Scout to retry.</div>';
      console.error('Scout renderer failed to load',error);
      throw error;
    }finally{loading=null}
  })();
  return loading;
}

function isSignalOpen(event){
  const d=event.detail||{},source=String(d.source||''),page=store.get().navigation?.page||store.get().runtime?.page;
  return source.startsWith('signals')||(page==='signals'&&Boolean(d.sku_id||d.product_id||d.scryfall_id||d.card_name));
}
function onSignalOpen(event){
  if(!isSignalOpen(event))return;
  event.preventDefault?.();event.stopImmediatePropagation?.();
  const detail={...(event.detail||{})};
  if(!signalFastOpenLoading)signalFastOpenLoading=import('./signal-fast-open.js');
  void signalFastOpenLoading.then(module=>module.openSignalScoutFast(detail)).catch(()=>{
    signalFastOpenLoading=null;
    window.CollectishShell?.switchPage?.('scout');
  });
}
document.addEventListener('collectish:open-scout-card',onSignalOpen,true);

registerComponent('scout-bootstrap',{
  mount:()=>startScout().catch(()=>{}),
  onPage:page=>{if(page==='scout')startScout().catch(()=>{})}
});

window.CollectishScoutBootstrap={start:startScout};
