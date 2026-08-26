import store from '../../state/store.js';

// Adds fast-path-safe Signals questions to the Ask starter bar.
(() => {
  if(window.__collectishAskSignalsStartersInstalled)return;
  window.__collectishAskSignalsStartersInstalled=true;
  const prompts=['What do Signals say?','Do Signals agree with Scout?','Is momentum early or confirmed?'];
  function submit(text){
    const form=document.getElementById('cxAskForm'),input=document.getElementById('cxAskInput');
    if(!form||!input)return;
    input.value=text;
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  }
  function sync(){
    const host=document.getElementById('cxAskStarters');if(!host)return;
    const scout=document.getElementById('cxScout');
    if(!scout?.classList.contains('active'))return;
    const selected=store.get().scout?.selectedSku||document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku;
    if(!selected)return;
    for(const text of prompts){
      if([...host.querySelectorAll('.cx-ask-starter')].some(b=>b.textContent?.trim()===text))continue;
      const b=document.createElement('button');b.type='button';b.className='cx-ask-starter cx-ask-signals-starter';b.textContent=text;b.onclick=()=>submit(text);host.append(b);
    }
  }
  document.addEventListener('click',()=>requestAnimationFrame(sync));
  document.addEventListener('collectish:scout-detail-rendered',()=>requestAnimationFrame(sync));
  document.addEventListener('collectish:page-changed',()=>requestAnimationFrame(sync));
  document.addEventListener('collectish:idle-modules-ready',()=>requestAnimationFrame(sync));
})();
