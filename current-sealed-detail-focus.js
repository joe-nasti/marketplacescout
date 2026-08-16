// Scout Sealed detail focus helper — keeps deck taps actionable on mobile and desktop.
(() => {
  function reveal(){
    const d=document.getElementById('cxSealedDetail');
    if(!d)return;
    d.setAttribute('tabindex','-1');
    if(matchMedia('(max-width:1100px)').matches)d.scrollIntoView({behavior:'smooth',block:'start'});
    else d.focus({preventScroll:true});
  }
  document.addEventListener('click',e=>{
    if(!e.target.closest('#cxSealedRows [data-deck]'))return;
    // The primary Sealed renderer updates asynchronously; reveal after it has started rendering.
    setTimeout(reveal,80);
    setTimeout(reveal,300);
  },true);
})();
