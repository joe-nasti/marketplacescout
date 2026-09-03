import store from '../../state/store.js';

// Adds shared Delvin market questions plus contextual Signals questions to Ask.
(() => {
  if(window.__collectishAskSignalsStartersInstalled)return;
  window.__collectishAskSignalsStartersInstalled=true;
  const sharedPrompts=[
    'What should I look at right now?',
    'What cards suddenly started selling faster?',
    'What SYP changes look most meaningful this week?',
    'What cards are gaining EDH demand this week?',
    'What creator-driven cards are moving?',
    'How are textured foils doing across sets?'
  ];
  const contextualPrompts=['What do Signals say?','Do Signals agree with Scout?','Is momentum early or confirmed?'];
  function submit(text){
    const form=document.getElementById('cxAskForm'),input=document.getElementById('cxAskInput');
    if(!form||!input)return;
    input.value=text;
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  }
  function add(host,text,cls=''){
    if([...host.querySelectorAll('.cx-ask-starter')].some(b=>b.textContent?.trim()===text))return;
    const b=document.createElement('button');b.type='button';b.className=`cx-ask-starter ${cls}`.trim();b.textContent=text;b.onclick=()=>submit(text);host.append(b);
  }
  function sync(){
    const host=document.getElementById('cxAskStarters');if(!host)return;
    for(const text of sharedPrompts)add(host,text,'cx-ask-delvin-starter');
    const scout=document.getElementById('cxScout');
    if(!scout?.classList.contains('active'))return;
    const selected=store.get().scout?.selectedSku||document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku;
    if(!selected)return;
    for(const text of contextualPrompts)add(host,text,'cx-ask-signals-starter');
  }
  document.addEventListener('click',()=>requestAnimationFrame(sync));
  document.addEventListener('collectish:scout-detail-rendered',()=>requestAnimationFrame(sync));
  document.addEventListener('collectish:page-changed',()=>requestAnimationFrame(sync));
  document.addEventListener('collectish:idle-modules-ready',()=>requestAnimationFrame(sync));
  requestAnimationFrame(sync);
})();