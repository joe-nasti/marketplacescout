// Collectish Scout diversity layer — keep the first screen score-first without letting one set monopolize it.
(() => {
  const FIRST_SCREEN=48;
  const MAX_PER_SET=4;
  let queued=false;

  function cardInfo(card,index){
    const scoreText=card.querySelector('.cx-score-mini')?.textContent||'0';
    const score=Number((scoreText.match(/-?\d+(?:\.\d+)?/)||['0'])[0]);
    const meta=card.querySelector('.cx-scout-card-body > small')?.textContent||'';
    const set=(meta.split(' • ')[0]||'Unknown set').trim();
    return {card,index,score,set};
  }

  function diversify(){
    queued=false;
    const host=document.getElementById('cxParityCards');
    if(!host)return;
    const cards=[...host.querySelectorAll(':scope > .cx-scout-card')];
    if(cards.length<2)return;

    const items=cards.map(cardInfo).sort((a,b)=>b.score-a.score||a.index-b.index);
    const picked=[];
    const deferred=[];
    const counts=new Map();

    for(const item of items){
      const n=counts.get(item.set)||0;
      if(picked.length<FIRST_SCREEN && n<MAX_PER_SET){
        picked.push(item);
        counts.set(item.set,n+1);
      }else deferred.push(item);
    }

    // Fill any short first screen from the highest remaining scores, then retain score order afterwards.
    while(picked.length<FIRST_SCREEN && deferred.length)picked.push(deferred.shift());
    const ordered=[...picked,...deferred];
    const changed=ordered.some((x,i)=>x.card!==cards[i]);
    if(changed){
      const frag=document.createDocumentFragment();
      ordered.forEach(x=>frag.appendChild(x.card));
      host.appendChild(frag);
    }

    const page=document.getElementById('cxScout');
    if(page){
      let note=page.querySelector('.cx-scout-diversity-note');
      if(!note){
        note=document.createElement('small');
        note.className='cx-sub cx-scout-diversity-note';
        const toolbar=page.querySelector('.cx-scout-toolbar');
        if(toolbar)toolbar.insertAdjacentElement('afterend',note);
      }
      if(note)note.textContent=`Top opportunities are score-ranked across the 24h snapshot; first screen capped at ${MAX_PER_SET} cards per set for diversity.`;
    }
  }

  function schedule(){if(queued)return;queued=true;requestAnimationFrame(diversify)}
  const mo=new MutationObserver(mutations=>{
    if(mutations.some(m=>m.target.id==='cxParityCards'||m.target.closest?.('#cxParityCards')))schedule();
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('input',e=>{if(e.target.closest?.('#cxScout'))setTimeout(schedule,0)},true);
  document.addEventListener('change',e=>{if(e.target.closest?.('#cxScout'))setTimeout(schedule,0)},true);
  schedule();
})();
