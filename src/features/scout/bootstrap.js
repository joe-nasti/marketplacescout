let started=false;
let loading=null;

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
      if(host)host.innerHTML='<div class="cx-empty">Scout failed to load. Tap Scout to retry.</div>';
      console.error('Scout renderer failed to load',error);
      throw error;
    }finally{
      loading=null;
    }
  })();
  return loading;
}

export function installScoutBootstrap(){
  document.addEventListener('collectish:ready',()=>queueMicrotask(()=>startScout().catch(()=>{})),{once:true});
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-cx-page="scout"]'))setTimeout(()=>startScout().catch(()=>{}),0);
  },true);
  if(document.getElementById('cxScout'))queueMicrotask(()=>startScout().catch(()=>{}));
  window.CollectishScoutBootstrap={start:startScout};
}

installScoutBootstrap();
