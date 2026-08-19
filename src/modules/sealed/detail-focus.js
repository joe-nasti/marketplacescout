import { registerComponent } from '../../core/lifecycle.js';

const mobile=()=>matchMedia('(max-width:700px)').matches;
const detail=()=>document.getElementById('cxSealedDetail');
let pendingOpen=false;

function ensureClose(){
  const d=detail();if(!d)return;
  let b=d.querySelector('.cx-sealed-detail-close');
  if(!b){b=document.createElement('button');b.type='button';b.className='cx-sealed-detail-close';b.setAttribute('aria-label','Close deck details');b.textContent='×';b.addEventListener('click',close);d.prepend(b)}
}

function open(){
  const d=detail();if(!d)return;
  d.setAttribute('tabindex','-1');
  if(mobile()){
    d.classList.add('cx-sealed-detail-open');document.body.classList.add('cx-sealed-detail-lock');ensureClose();d.scrollTop=0;d.focus({preventScroll:true});
  }else d.focus({preventScroll:true});
}

function close(){const d=detail();d?.classList.remove('cx-sealed-detail-open');document.body.classList.remove('cx-sealed-detail-lock');pendingOpen=false}
function onClick(event){if(event.target.closest?.('.cx-sealed-detail-close')){close();return}if(event.target.closest?.('#cxSealedRows [data-deck]'))pendingOpen=true}
function onRendered(){if(pendingOpen)open();else if(detail()?.classList.contains('cx-sealed-detail-open'))ensureClose()}
function onKey(event){if(event.key==='Escape')close()}

registerComponent('sealed-detail-focus',{
  mount(){document.addEventListener('click',onClick,true);document.addEventListener('keydown',onKey);document.addEventListener('collectish:sealed-detail-rendered',onRendered)},
  unmount(){document.removeEventListener('click',onClick,true);document.removeEventListener('keydown',onKey);document.removeEventListener('collectish:sealed-detail-rendered',onRendered);close()},
  onPage(page){if(page!=='sealed')close()}
});
