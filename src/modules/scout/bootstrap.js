import { registerComponent } from '../../core/lifecycle.js';

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
      host.innerHTML='<div class="cx-empty">Scout failed to load. Reopen Scout to retry.</div>';
      console.error('Scout renderer failed to load',error);
      throw error;
    }finally{loading=null}
  })();
  return loading;
}

registerComponent('scout-bootstrap',{
  mount:()=>startScout().catch(()=>{}),
  onPage:page=>{if(page==='scout')startScout().catch(()=>{})}
});

window.CollectishScoutBootstrap={start:startScout};
