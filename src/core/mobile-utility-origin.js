const mobile=matchMedia('(max-width:700px)');
let initialSettling=false;
let userInteracted=false;
let gestureActive=false;
let snapTimer=0;
let scrollEndTimer=0;

function mobileOrigin(){
  if(!mobile.matches)return 0;
  const shelf=document.getElementById('cxMobileUtilities');
  if(!shelf)return 0;
  const rect=shelf.getBoundingClientRect();
  return Math.max(0,Math.round(window.scrollY+rect.bottom));
}

function alignToOrigin({force=false,behavior='auto'}={}){
  if(!mobile.matches||gestureActive)return;
  if(initialSettling&&userInteracted&&!force)return;
  const top=mobileOrigin();
  if(top<=0)return;
  window.scrollTo({top,behavior});
}

function settleInitialOrigin(){
  if(!mobile.matches)return;
  initialSettling=true;
  userInteracted=false;
  requestAnimationFrame(()=>requestAnimationFrame(()=>alignToOrigin()));
  for(const delay of [80,240,700])setTimeout(()=>alignToOrigin(),delay);
  setTimeout(()=>{initialSettling=false},900);
}

function noteInteraction(){if(initialSettling)userInteracted=true}

function shelfIsPartlyRevealed(){
  if(!mobile.matches)return false;
  const top=window.scrollY;
  const origin=mobileOrigin();
  return top>1&&origin>0&&top<origin-2;
}

function snapIfNeeded(){
  clearTimeout(snapTimer);
  if(gestureActive||initialSettling)return;
  if(shelfIsPartlyRevealed())alignToOrigin({force:true,behavior:'smooth'});
}

function scheduleShelfSnap(delay=140){
  clearTimeout(snapTimer);
  snapTimer=setTimeout(snapIfNeeded,delay);
}

function onPointerDown(event){
  if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
  gestureActive=true;
  clearTimeout(snapTimer);
  clearTimeout(scrollEndTimer);
  noteInteraction();
}

function onPointerEnd(event){
  if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
  gestureActive=false;
  scheduleShelfSnap(180);
}

function onScroll(){
  if(gestureActive)return;
  if('onscrollend' in window)return;
  clearTimeout(scrollEndTimer);
  scrollEndTimer=setTimeout(()=>scheduleShelfSnap(0),180);
}

function onUtilityUse(event){
  if(!mobile.matches)return;
  if(!event.target.closest?.('#cxMobileUtilities [data-cx-theme-toggle], #cxMobileUtilities [data-cx-build-badge="1"]'))return;
  setTimeout(()=>alignToOrigin({force:true,behavior:'smooth'}),160);
}

function onPageChange(){
  if(!mobile.matches)return;
  if(document.querySelector('[data-collectish-startup]'))return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>alignToOrigin({force:true})));
}

export function installMobileUtilityOrigin(){
  try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch{}
  document.addEventListener('collectish:ready',settleInitialOrigin);
  document.addEventListener('collectish:page-change',onPageChange);
  document.addEventListener('click',onUtilityUse,true);
  window.addEventListener('pageshow',()=>setTimeout(settleInitialOrigin,0));
  mobile.addEventListener?.('change',event=>{if(event.matches)setTimeout(settleInitialOrigin,0)});
  window.addEventListener('pointerdown',onPointerDown,{passive:true});
  window.addEventListener('pointerup',onPointerEnd,{passive:true});
  window.addEventListener('pointercancel',onPointerEnd,{passive:true});
  window.addEventListener('scroll',onScroll,{passive:true});
  if('onscrollend' in window)window.addEventListener('scrollend',()=>scheduleShelfSnap(0),{passive:true});
}

installMobileUtilityOrigin();
window.CollectishMobileUtilityOrigin={align:alignToOrigin,settle:settleInitialOrigin,origin:mobileOrigin,snap:()=>alignToOrigin({force:true,behavior:'smooth'})};
