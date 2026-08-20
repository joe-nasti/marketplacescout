import store from '../../state/store.js';
import { readUrlState, writeUrlState, onUrlStateChange } from '../../core/url-state.js';

let installed=false,applying=false,stopStore=null,stopUrl=null;

function applyState(urlState){
  const u=urlState?.sealed||{},current=store.get().sealed||{},saved=localStorage.getItem('collectishSealedLanguageFilter')||'all';
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
      language:u.language||saved
    },
    selectedId:u.selectedId||current.selectedId||null
  });
  applying=false;
}

function persistFromState(sealed){
  if(applying)return;
  const f=sealed?.filters||{};
  if(f.language)localStorage.setItem('collectishSealedLanguageFilter',f.language);
  writeUrlState({sealed:{
    query:f.query||'',
    status:f.status||'',
    setType:f.setType||'',
    language:f.language||'all',
    selectedId:sealed?.selectedId||null
  }},{replace:true});
}

export function installSealedUrlState(){
  if(installed)return;
  installed=true;
  applyState(readUrlState());
  stopStore=store.subscribe(
    s=>({filters:s.sealed?.filters||{},selectedId:s.sealed?.selectedId||null}),
    value=>persistFromState(value),
    {immediate:false}
  );
  stopUrl=onUrlStateChange(state=>{
    if(state.tab!=='sealed')return;
    applyState(state);
    window.CollectishSealed?.load?.(false);
  });
}

export function uninstallSealedUrlState(){
  stopStore?.();stopUrl?.();stopStore=stopUrl=null;installed=false;
}
