const mobile=matchMedia('(max-width:700px)');
let initialSettling=false;
let userInteracted=false;
let gestureActive=false;
let snapTimer=0;

function originTarget(){
  return document.getElementById('cxRouteContext')||document.querySelector('#collectishUxShell > .cx-main');
}

function mobileOrigin(){
  if(!mobile.matches)return 0;
  const target=originTarget();
  if(!target)return 0;
  const rect=target.getBoundingClientRect();
  return Math.max(0,Math.round(window.scrollY+rect.top));
}

function alignToOrigin({force=false,behavior='auto'}={}){
  if(!mobile.matches)return;
  if(initialSettling&&userInteracted&&!force)return;
  const target=originTarget();
  const top=mobileOrigin();
  if(!target||top<=0)return;
  if(behavior==='smooth'){
    window.scrollTo({top,behavior:'smooth'});
    return;
  }
  try{target.scrollIntoView({block:'start',inline:'nearest',behavior:'auto'})}catch{}
  requestAnimationFrame(()=>{
    const delta=Math.abs(window.scrollY-top);
    if(delta>2)window.scrollTo(0,top);
  });
}

function settleInitialOrigin(){
  if(!mobile.matches)return;
  initialSettling=true;
  userInteracted=false;
  requestAnimationFrame(()=>requestAnimationFrame(()=>alignToOrigin()));
  for(const delay of [40,120,300,700,1200])setTimeout(()=>alignToOrigin(),delay);
  setTimeout(()=>{initialSettling=false},1400);
}

function noteInteraction(){if(initialSettling)userInteracted=true}

function shelfIsPartlyRevealed(){
  if(!mobile.matches)return false;
  const top=window.scrollY;
  const origin=mobileOrigin();
  return top>1&&origin>0&&top<origin-2;
}

function scheduleShelfSnap(delay=150){
  clearTimeout(snapTimer);
  snapTimer=setTimeout(()=>{
    if(gestureActive||initialSettling)return;
    if(shelfIsPartlyRevealed())alignToOrigin({force:true,behavior:'smooth'});
  },delay);
}

function onGestureStart(){
  gestureActive=true;
  clearTimeout(snapTimer);
  noteInteraction();
}

function onGestureEnd(){
  gestureActive=false;
  scheduleShelfSnap(120);
}

function onUtilityUse(event){
  if(!mobile.matches)return;
  if(!event.target.closest?.('#cxMobileUtilities [data-cx-theme-toggle], #cxMobileUtilities [data-cx-build-badge="1"]'))return;
  setTimeout(()=>alignToOrigin({force:true,behavior:'smooth'}),160);
}

export function installMobileUtilityOrigin(){
  try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch{}
  document.addEventListener('collectish:ready',settleInitialOrigin);
  document.addEventListener('collectish:page-change',()=>{
    if(!mobile.matches)return;
    if(document.querySelector('[data-collectish-startup]'))return;
    requestAnimationFrame(()=>alignToOrigin({force:true}));
  });
  document.addEventListener('click',onUtilityUse,true);
  window.addEventListener('pageshow',()=>setTimeout(settleInitialOrigin,0));
  mobile.addEventListener?.('change',event=>{if(event.matches)setTimeout(settleInitialOrigin,0)});
  window.addEventListener('scroll',()=>{if(!gestureActive)scheduleShelfSnap(180)},{passive:true});
  window.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'||event.pointerType==='pen')onGestureStart()},{passive:true});
  window.addEventListener('pointerup',event=>{if(event.pointerType==='touch'||event.pointerType==='pen')onGestureEnd()},{passive:true});
  window.addEventListener('pointercancel',event=>{if(event.pointerType==='touch'||event.pointerType==='pen')onGestureEnd()},{passive:true});
  window.addEventListener('touchstart',onGestureStart,{passive:true});
  window.addEventListener('touchend',onGestureEnd,{passive:true});
  window.addEventListener('touchcancel',onGestureEnd,{passive:true});
}

installMobileUtilityOrigin();
window.CollectishMobileUtilityOrigin={align:alignToOrigin,settle:settleInitialOrigin,origin:mobileOrigin,snap:()=>alignToOrigin({force:true,behavior:'smooth'})};
