// Mobile detail swipe navigation shared by Scout and Scout Sealed.
(() => {
  const THRESHOLD=56,RATIO=1.25;
  function bind(detailId,listSelector,itemSelector,selectedSelector){
    let sx=0,sy=0,tracking=false;
    const detail=()=>document.getElementById(detailId);
    function move(dir){
      const items=[...document.querySelectorAll(`${listSelector} ${itemSelector}`)];if(!items.length)return;
      let i=items.findIndex(x=>x.matches(selectedSelector));if(i<0)i=0;
      const target=items[i+dir];if(!target)return;
      target.click();setTimeout(()=>{const d=detail();if(d)d.scrollTop=0},100);
    }
    document.addEventListener('touchstart',e=>{
      const d=detail();if(!d||!d.contains(e.target)||e.touches.length!==1)return;
      // Horizontal/interactive regions own their gestures. Never turn a table drag into next/previous product navigation.
      if(e.target.closest('a,button,input,select,textarea,.cx-sealed-econ-wrap,.cx-sealed-econ,[data-no-detail-swipe]'))return;
      sx=e.touches[0].clientX;sy=e.touches[0].clientY;tracking=true;
    },{passive:true});
    document.addEventListener('touchend',e=>{
      if(!tracking||!e.changedTouches.length)return;tracking=false;
      const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
      if(Math.abs(dx)<THRESHOLD||Math.abs(dx)<Math.abs(dy)*RATIO)return;
      // Swipe left advances down the list; swipe right goes back up.
      move(dx<0?1:-1);
    },{passive:true});
  }
  bind('cxParityDetail','#cxParityCards','.cx-scout-card','.selected');
  bind('cxSealedDetail','#cxSealedRows','[data-deck]','.selected');
})();
