import { registerComponent } from '../../core/lifecycle.js';
import store from '../../state/store.js';

let started=false;
let loading=null;
let signalFastOpenLoading=null;
let deepLinkSeq=0;

function scoutHostNeedsHydration(){
  const host=document.getElementById('cxScout');
  return Boolean(host&&host.childElementCount===0);
}
async function restoreScoutSurface(){
  if(!scoutHostNeedsHydration())return false;
  const renderer=window.CollectishScoutRenderer;
  if(!renderer?.load)return false;
  await renderer.load();
  return true;
}

function deepLinkState(){
  const p=new URL(location.href).searchParams;
  return {
    sku:p.get('sku')||'',
    product_id:p.get('product')||'',
    card_name:p.get('card')||'',
    set_code:p.get('set')||'',
    finish:p.get('finish')||''
  };
}
async function openColdDeepLink(){
  const seq=++deepLinkSeq,d=deepLinkState();
  if(!d.sku&&!d.product_id&&!d.card_name)return false;
  window.CollectishShell?.switchPage?.('scout');
  if(d.sku){
    const module=await import('./detail-navigation.js');
    if(seq!==deepLinkSeq)return false;
    const detail={sku_id:d.sku,source:'discord-deep-link'};
    const open=()=>seq===deepLinkSeq&&Boolean(module.openScoutDetail(detail));
    window.CollectishScoutRenderer?.prepareDeepLinkSurface?.();
    if(document.getElementById('cxParityDetail'))return open();
    document.addEventListener('collectish:scout-v5-ready',open,{once:true});
    return true;
  }
  if(!signalFastOpenLoading)signalFastOpenLoading=import('./signal-fast-open.js');
  const module=await signalFastOpenLoading;
  if(seq!==deepLinkSeq)return false;
  await module.openSignalScoutFast({source:'signals-discord-deep-link',product_id:d.product_id||null,card_name:d.card_name||null,set_code:d.set_code||null,finish:d.finish||null});
  return true;
}

export async function startScout(){
  if(started){
    await restoreScoutSurface().catch(error=>console.warn('Scout surface restore failed',error));
    queueMicrotask(()=>void openColdDeepLink().catch(()=>{}));
    return;
  }
  if(loading){
    await loading;
    await restoreScoutSurface().catch(error=>console.warn('Scout surface restore failed',error));
    return;
  }
  const host=document.getElementById('cxScout');
  if(!host)return;
  loading=(async()=>{
    try{
      const module=await import('./index.js');
      await module.installScoutRenderer();
      started=true;
      queueMicrotask(()=>void openColdDeepLink().catch(error=>console.warn('Scout deep link failed',error)));
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
document.addEventListener('collectish:shell-rendered',event=>{
  if(event.detail?.screen==='app')queueMicrotask(()=>void startScout().catch(()=>{}));
});
window.addEventListener('pageshow',()=>queueMicrotask(()=>void startScout().catch(()=>{})));
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)queueMicrotask(()=>void startScout().catch(()=>{}));
});

registerComponent('scout-bootstrap',{
  mount:()=>startScout().catch(()=>{}),
  onPage:page=>{if(page==='scout')startScout().catch(()=>{})}
});

window.CollectishScoutBootstrap={start:startScout,openDeepLink:openColdDeepLink};
