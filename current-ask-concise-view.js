// Ask Collectish concise view — progressive disclosure only, event-driven, no observers/RPCs.
(() => {
  const DETAIL_LABELS=new Set(['CORE SETUP','COVERAGE','GAPS']);
  const IMPORTANT_LABELS=new Set(['THESIS','EVIDENCE','RISKS','ENTRY','EXIT / TARGET','POSITION SIZE','DATA QUALITY']);

  function wrapDetails(el,nodes,label='Show deeper evidence'){
    if(!nodes.length)return;
    const d=document.createElement('details');d.className='cx-ask-deeper';
    const s=document.createElement('summary');s.textContent=label;d.append(s);
    const body=document.createElement('div');body.className='cx-ask-deeper-body';
    nodes.forEach(n=>body.append(n));d.append(body);el.append(d);
  }

  function investigate(el){
    const all=[...el.children];
    if(!all.some(x=>x.classList?.contains('cx-investigate-summary')))return false;
    const collapse=[];
    let current='';
    for(const n of all){
      if(n.classList?.contains('cx-investigate-summary'))continue;
      if(n.tagName==='H2'&&n.classList.contains('cx-investigate-section')){
        current=(n.textContent||'').trim().toUpperCase();
        if(DETAIL_LABELS.has(current)){collapse.push(n);continue}
        if(!IMPORTANT_LABELS.has(current)&&current){collapse.push(n);continue}
        continue;
      }
      if(DETAIL_LABELS.has(current)||(!IMPORTANT_LABELS.has(current)&&current))collapse.push(n);
    }
    wrapDetails(el,collapse,'Show deeper evidence');
    el.dataset.concise='investigate';
    return true;
  }

  function generic(el){
    if(el.dataset.concise)return;
    const text=(el.textContent||'').trim();
    if(text.length<1500)return;
    const blocks=[...el.children].filter(n=>!n.classList?.contains('cx-investigate-summary'));
    if(blocks.length<7)return;
    let keep=0,seenList=false;
    for(let i=0;i<blocks.length;i++){
      const n=blocks[i];
      if(i<4){keep=i+1;continue}
      if(!seenList&&(n.tagName==='UL'||n.tagName==='OL')){seenList=true;keep=i+1;continue}
      if(keep>=5)break;
      keep=i+1;
    }
    const collapse=blocks.slice(Math.max(5,keep));
    wrapDetails(el,collapse,'Show full analysis');
    el.dataset.concise='generic';
  }

  function apply(el){
    if(!el||el.dataset?.concise)return;
    if(investigate(el))return;
    generic(el);
  }
  function schedule(el){[0,60,180].forEach(ms=>setTimeout(()=>apply(el),ms))}
  document.addEventListener('collectish:ask-message-rendered',e=>{if(e.detail?.role==='assistant')schedule(e.detail.element)});
  document.addEventListener('submit',e=>{if(e.target?.id==='cxAskForm')setTimeout(()=>document.querySelectorAll('#cxAskMessages .cx-ask-assistant .cx-ask-msg-body[data-md]:not([data-concise])').forEach(apply),250)},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('#cxAskInvestigate,.cx-ask-starter,.cx-v3-starter'))setTimeout(()=>document.querySelectorAll('#cxAskMessages .cx-ask-assistant .cx-ask-msg-body[data-md]:not([data-concise])').forEach(apply),350)},true);
  window.CollectishApplyConciseView=apply;
})();
