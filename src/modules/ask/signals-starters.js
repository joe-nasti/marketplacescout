import store from '../../state/store.js';

// Adds shared Delvin questions plus contextual Signals questions to Ask.
// The shared questions come from the same capability manifest Discord autocomplete uses.
(() => {
  if(window.__collectishAskSignalsStartersInstalled)return;
  window.__collectishAskSignalsStartersInstalled=true;
  const fallbackPrompts=[
    'What should I look at right now?',
    'What cards suddenly started selling faster?',
    'What SYP changes look most meaningful this week?',
    'What cards are gaining EDH demand this week?',
    'What creator-driven cards are moving?',
    'How are textured foils doing across sets?'
  ];
  const contextualPrompts=['What do Signals say?','Do Signals agree with Scout?','Is momentum early or confirmed?'];
  let manifestPrompts=null,manifestPromise=null;
  function submit(text){
    const form=document.getElementById('cxAskForm'),input=document.getElementById('cxAskInput');
    if(!form||!input)return;
    input.value=text;
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  }
  function add(host,text,cls='',meta=null){
    if([...host.querySelectorAll('.cx-ask-starter')].some(b=>b.textContent?.trim()===text))return;
    const b=document.createElement('button');b.type='button';b.className=`cx-ask-starter ${cls}`.trim();b.textContent=text;b.onclick=()=>submit(text);
    if(meta?.description)b.title=meta.description;
    if(meta?.query_key)b.dataset.delvinQueryKey=meta.query_key;
    if(meta?.capability_kind)b.dataset.delvinCapabilityKind=meta.capability_kind;
    if(meta?.warm)b.dataset.delvinWarm='true';
    host.append(b);
  }
  async function loadManifest(){
    if(manifestPrompts)return manifestPrompts;
    if(manifestPromise)return manifestPromise;
    manifestPromise=(async()=>{
      try{
        if(typeof window.rest!=='function')return fallbackPrompts.map(prompt=>({prompt}));
        const rows=await window.rest('rpc/get_delvin_capability_manifest_v1',{method:'POST',body:{p_client:'web',p_limit:24}});
        const useful=(Array.isArray(rows)?rows:[]).filter(x=>x?.discoverable!==false&&x?.prompt).slice(0,12);
        manifestPrompts=useful.length?useful:fallbackPrompts.map(prompt=>({prompt}));
      }catch{
        manifestPrompts=fallbackPrompts.map(prompt=>({prompt}));
      }
      return manifestPrompts;
    })();
    return manifestPromise;
  }
  async function sync(){
    const host=document.getElementById('cxAskStarters');if(!host)return;
    const shared=await loadManifest();
    for(const item of shared)add(host,item.prompt,'cx-ask-delvin-starter',item);
    const scout=document.getElementById('cxScout');
    if(!scout?.classList.contains('active'))return;
    const selected=store.get().scout?.selectedSku||document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku;
    if(!selected)return;
    for(const text of contextualPrompts)add(host,text,'cx-ask-signals-starter');
  }
  const schedule=()=>requestAnimationFrame(()=>void sync());
  document.addEventListener('click',schedule);
  document.addEventListener('collectish:scout-detail-rendered',schedule);
  document.addEventListener('collectish:page-changed',schedule);
  document.addEventListener('collectish:idle-modules-ready',schedule);
  schedule();
})();