// Keep Scout's active DOM small while preserving the renderer's existing card nodes.
let pool=[];
let sentinel=null;
let observer=null;
let compactQueued=false;
let expansionEvent=false;

const mobile=()=>matchMedia('(max-width:980px)').matches;
const initialLimit=()=>mobile()?32:56;
const batchSize=()=>mobile()?20:32;
const host=()=>document.getElementById('cxParityCards');

function cleanup(){
  observer?.disconnect();observer=null;
  sentinel?.remove();sentinel=null;
  pool=[];
}

function refreshDecorators(){
  window.CollectishScoutListImages?.refresh?.();
  window.CollectishScoutVolatility?.decorate?.();
  window.CollectishScoutNoiseFilter?.apply?.();
}

function updateSentinel(){
  if(!sentinel)return;
  if(!pool.length){observer?.disconnect();sentinel.remove();sentinel=null;return}
  const n=Math.min(batchSize(),pool.length);
  sentinel.textContent=`Show ${n} more · ${pool.length} remaining`;
}

function appendBatch(){
  const h=host();if(!h||!pool.length)return;
  const batch=pool.splice(0,batchSize());
  const frag=document.createDocumentFragment();
  for(const node of batch)frag.append(node);
  h.insertBefore(frag,sentinel);
  updateSentinel();
  refreshDecorators();
  expansionEvent=true;
  document.dispatchEvent(new CustomEvent('collectish:scout-list-rendered',{detail:{count:h.querySelectorAll('.cx-scout-card').length,expanded:true,remaining:pool.length}}));
  queueMicrotask(()=>{expansionEvent=false});
}

function ensureSentinel(h){
  sentinel=document.createElement('button');
  sentinel.type='button';
  sentinel.className='cx-refresh cx-scout-progressive-more';
  sentinel.addEventListener('click',appendBatch);
  h.append(sentinel);
  updateSentinel();
  if('IntersectionObserver' in window){
    observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting))appendBatch()},{rootMargin:'700px 0px'});
    observer.observe(sentinel);
  }
}

function compact(){
  compactQueued=false;
  const h=host();if(!h)return;
  // While the current progressive session is still connected, preserve its
  // sentinel and detached-card pool. Decorators and viewport work can emit
  // additional list-render events; rebuilding here would detach the visible
  // "Show more" control underneath an in-progress pointer/click interaction.
  // A true list replacement disconnects the old sentinel, so the next render
  // still falls through and establishes a fresh progressive session.
  if(sentinel?.isConnected&&pool.length)return;
  cleanup();
  const cards=[...h.querySelectorAll(':scope > .cx-scout-card')];
  const limit=initialLimit();
  if(cards.length<=limit)return;
  pool=cards.slice(limit);
  for(const card of pool)card.remove();
  ensureSentinel(h);
  refreshDecorators();
  h.dataset.progressiveRendered=String(limit);
  h.dataset.progressiveRemaining=String(pool.length);
  document.dispatchEvent(new CustomEvent('collectish:scout-progressive-ready',{detail:{connected:limit,remaining:pool.length,total:cards.length}}));
}

function scheduleCompact(){
  if(compactQueued)return;compactQueued=true;
  requestAnimationFrame(()=>requestAnimationFrame(compact));
}

document.addEventListener('collectish:scout-list-rendered',event=>{
  if(expansionEvent||event.detail?.expanded)return;
  scheduleCompact();
});
document.addEventListener('collectish:page-change',event=>{if(event.detail?.page==='scout')setTimeout(scheduleCompact,80)});
addEventListener('resize',()=>{if(host())setTimeout(scheduleCompact,120)},{passive:true});

const style=document.createElement('style');
style.textContent=`
#cxParityCards>.cx-scout-card{content-visibility:auto;contain-intrinsic-size:auto 132px}
.cx-scout-progressive-more{display:block;width:100%;min-height:44px;margin:10px 0 2px}
@media(max-width:980px){#cxParityCards>.cx-scout-card{contain-intrinsic-size:auto 154px}}
`;
document.head.append(style);

window.CollectishScoutProgressive={compact,appendBatch,getState:()=>({connected:host()?.querySelectorAll('.cx-scout-card').length||0,remaining:pool.length})};
