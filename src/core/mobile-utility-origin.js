const mobile=matchMedia('(max-width:700px)');
let initialSettling=false;
let userInteracted=false;

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

function alignToOrigin({force=false}={}){
  if(!mobile.matches)return;
  if(initialSettling&&userInteracted&&!force)return;
  const target=originTarget();
  const top=mobileOrigin();
  if(!target||top<=0)return;
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

export function installMobileUtilityOrigin(){
  try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch{}
  document.addEventListener('collectish:ready',settleInitialOrigin);
  document.addEventListener('collectish:page-change',()=>{
    if(!mobile.matches)return;
    if(document.querySelector('[data-collectish-startup]'))return;
    requestAnimationFrame(()=>alignToOrigin({force:true}));
  });
  window.addEventListener('pageshow',()=>setTimeout(settleInitialOrigin,0));
  mobile.addEventListener?.('change',event=>{if(event.matches)setTimeout(settleInitialOrigin,0)});
  window.addEventListener('pointerdown',noteInteraction,{passive:true});
  window.addEventListener('touchstart',noteInteraction,{passive:true});
}

installMobileUtilityOrigin();
window.CollectishMobileUtilityOrigin={align:alignToOrigin,settle:settleInitialOrigin,origin:mobileOrigin};
