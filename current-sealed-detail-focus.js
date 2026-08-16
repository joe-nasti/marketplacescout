// Scout Sealed detail interaction — desktop side panel, mobile full-height sheet.
(() => {
  const mobile=()=>matchMedia('(max-width:700px)').matches;
  const detail=()=>document.getElementById('cxSealedDetail');
  function ensureClose(){
    const d=detail();if(!d||d.querySelector('.cx-sealed-detail-close'))return;
    const b=document.createElement('button');b.type='button';b.className='cx-sealed-detail-close';b.setAttribute('aria-label','Close deck details');b.textContent='×';b.onclick=close;d.prepend(b);
  }
  function open(){
    const d=detail();if(!d)return;
    ensureClose();d.setAttribute('tabindex','-1');
    if(mobile()){
      d.classList.add('cx-sealed-detail-open');document.body.classList.add('cx-sealed-detail-lock');
      d.scrollTop=0;d.focus({preventScroll:true});
    }else d.focus({preventScroll:true});
  }
  function close(){const d=detail();d?.classList.remove('cx-sealed-detail-open');document.body.classList.remove('cx-sealed-detail-lock')}
  document.addEventListener('click',e=>{
    if(e.target.closest('.cx-sealed-detail-close')){close();return}
    if(!e.target.closest('#cxSealedRows [data-deck]'))return;
    // Selection starts immediately; wait for async card detail replacement, then open the sheet.
    setTimeout(open,30);setTimeout(open,180);
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  document.addEventListener('collectish:ready',()=>{const d=detail();if(d)new MutationObserver(ensureClose).observe(d,{childList:true})});
})();
