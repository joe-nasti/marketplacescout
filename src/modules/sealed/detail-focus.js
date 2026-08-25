import { registerComponent } from '../../core/lifecycle.js';
import { ASK_PREFETCH_CONFIG } from '../../core/config.js';
import { prefetchAskContext, abortAskPrefetch } from '../ask/prefetch.js';

const mobile=()=>matchMedia('(max-width:700px)').matches;
const detail=()=>document.getElementById('cxSealedDetail');
const num=v=>v==null||v===''?null:Number(v);
let pendingOpen=false;

function ensureClose(){
  const d=detail();if(!d)return;
  let b=d.querySelector('.cx-sealed-detail-close');
  if(!b){b=document.createElement('button');b.type='button';b.className='cx-sealed-detail-close';b.setAttribute('aria-label','Close deck details');b.textContent='×';b.addEventListener('click',close);d.prepend(b)}
}

function sealedSnapshot(product={}){
  return {
    name:product.name??product.product_name??null,
    acquisition:num(product.sealedBuy??product.sealed_acquisition_price??product.price),
    marketEV:num(product.marketEV??product.tcg_market_ev),
    spread:num(product.marketSpread??product.market_spread??product.spreadPercent),
    ckBuylistFloor:num(product.ckBuylistFloor??product.cardkingdom_buylist_ev??product.ckBuylist)
  };
}

function prefetch(product={}){
  if(!ASK_PREFETCH_CONFIG.enabled)return;
  const snapshot=sealedSnapshot(product);
  if(!snapshot.name)return;
  void prefetchAskContext({
    scope:'sealed',
    identity:product.sealed_uuid??product.product_id??snapshot.name,
    snapshot,
    context:{screen:'sealed',sealed_uuid:product.sealed_uuid??null,product_id:product.product_id??null}
  });
}

function open(){
  const d=detail();if(!d)return;
  d.setAttribute('tabindex','-1');
  if(mobile()){
    d.classList.add('cx-sealed-detail-open');document.body.classList.add('cx-sealed-detail-lock');ensureClose();d.scrollTop=0;d.focus({preventScroll:true});
  }else d.focus({preventScroll:true});
}

function close(){abortAskPrefetch();const d=detail();d?.classList.remove('cx-sealed-detail-open');document.body.classList.remove('cx-sealed-detail-lock');pendingOpen=false}
function onClick(event){if(event.target.closest?.('.cx-sealed-detail-close')){close();return}if(event.target.closest?.('#cxSealedRows [data-deck]')){abortAskPrefetch();pendingOpen=true}}
function onRendered(event){const product=event.detail?.row||{};prefetch(product);if(pendingOpen)open();else if(detail()?.classList.contains('cx-sealed-detail-open'))ensureClose()}
function onKey(event){if(event.key==='Escape')close()}

registerComponent('sealed-detail-focus',{
  mount(){document.addEventListener('click',onClick,true);document.addEventListener('keydown',onKey);document.addEventListener('collectish:sealed-detail-rendered',onRendered)},
  unmount(){document.removeEventListener('click',onClick,true);document.removeEventListener('keydown',onKey);document.removeEventListener('collectish:sealed-detail-rendered',onRendered);close()},
  onPage(page){if(page!=='sealed')close()}
});

window.CollectishSealedAskPrefetch={snapshot:sealedSnapshot,prefetch,abort:abortAskPrefetch};
