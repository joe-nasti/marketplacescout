import store from '../../state/store.js';
import { readUrlState, writeUrlState, onUrlStateChange } from '../../core/url-state.js';

let installed=false,applying=false,stopStore=null,stopUrl=null,lastSnapshot=null;

function applyState(urlState){
  const u=urlState?.sealed||{},current=store.get().sealed||{};
  // set=LTR is intentionally represented through the existing sealed search field
  // until the toolbar grows a dedicated set-code control. The renderer's search haystack
  // includes set_code, so deep links are deterministic without a DOM patching layer.
  const query=u.query||(u.setCode?String(u.setCode):'');
  applying=true;
  store.update('sealed',{
    filters:{
      ...(current.filters||{}),
      query,
      status:u.status||'',
      setType:u.setType||'',
      language:u.language||'all',
      buylistBacked:Boolean(u.buylistBacked)
    },
    selectedId:u.selectedId||current.selectedId||null
  });
  applying=false;
}

function snapshot(sealed){
  const f=sealed?.filters||{};
  return {
    query:f.query||'',status:f.status||'',setType:f.setType||'',language:f.language||'all',
    buylistBacked:Boolean(f.buylistBacked),selectedId:sealed?.selectedId||null
  };
}

function persistFromState(sealed){
  if(applying)return;
  const next=snapshot(sealed),prev=lastSnapshot;
  const queryOnly=prev&&next.query!==prev.query&&next.status===prev.status&&next.setType===prev.setType&&next.language===prev.language&&next.buylistBacked===prev.buylistBacked&&next.selectedId===prev.selectedId;
  writeUrlState({tab:'sealed',sealed:next},{replace:Boolean(queryOnly)});
  lastSnapshot=next;
}

function syncVisibleControls(){
  const f=store.get().sealed?.filters||{};
  const search=document.getElementById('cxSealedSearch');if(search&&search.value!==(f.query||''))search.value=f.query||'';
  const status=document.getElementById('cxSealedFilter');if(status)status.value=f.status||'';
  const type=document.getElementById('cxSealedSetType');if(type)type.value=f.setType||'';
  const language=document.getElementById('cxSealedLanguagePricing');if(language)language.value=f.language||'all';
  const buylist=document.getElementById('cxSealedBuylistBacked');if(buylist){buylist.setAttribute('aria-pressed',f.buylistBacked?'true':'false');buylist.classList.toggle('active',Boolean(f.buylistBacked))}
}

export function installSealedUrlState(){
  if(installed)return;
  installed=true;
  applyState(readUrlState());
  lastSnapshot=snapshot(store.get().sealed||{});
  stopStore=store.subscribe(
    s=>JSON.stringify(snapshot(s.sealed||{})),
    ()=>persistFromState(store.get().sealed||{}),
    {immediate:false}
  );
  stopUrl=onUrlStateChange(state=>{
    if(state.tab!=='sealed')return;
    applyState(state);
    lastSnapshot=snapshot(store.get().sealed||{});
    syncVisibleControls();
    window.CollectishSealed?.render?.();
  });
}

export function uninstallSealedUrlState(){
  stopStore?.();stopUrl?.();stopStore=stopUrl=null;lastSnapshot=null;installed=false;
}
