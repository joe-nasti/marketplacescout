const mobile=matchMedia('(max-width:700px)');
let initialSettling=false;
let userInteracted=false;

function mobileOrigin(){
  if(!mobile.matches)return 0;
  const main=document.querySelector('#collectishUxShell > .cx-main');
  return Math.max(0,Math.round(main?.offsetTop||0));
}

function alignToOrigin({force=false}={}){
  if(!mobile.matches)return;
  if(initialSettling&&userInteracted&&!force)return;
  const top=mobileOrigin();
  if(top<=0)return;
  window.scrollTo({top,behavior:'auto'});
}

function settleInitialOrigin(){
  if(!mobile.matches)return;
  initialSettling=true;
  userInteracted=false;
  requestAnimationFrame(()=>requestAnimationFrame(()=>alignToOrigin()));
  for(const delay of [60,180,420])setTimeout(()=>alignToOrigin(),delay);
  setTimeout(()=>{initialSettling=false},550);
}

function noteInteraction(){if(initialSettling)userInteracted=true}

export function installMobileUtilityOrigin(){
  document.addEventListener('collectish:ready',settleInitialOrigin);
  document.addEventListener('collectish:page-change',event=>{
    if(!mobile.matches)return;
    if(document.querySelector('[data-collectish-startup]'))return;
    requestAnimationFrame(()=>alignToOrigin({force:true}));
  });
  window.addEventListener('pageshow',event=>{if(event.persisted)setTimeout(settleInitialOrigin,0)});
  mobile.addEventListener?.('change',event=>{if(event.matches)setTimeout(settleInitialOrigin,0)});
  window.addEventListener('pointerdown',noteInteraction,{passive:true});
  window.addEventListener('touchstart',noteInteraction,{passive:true});
}

installMobileUtilityOrigin();
window.CollectishMobileUtilityOrigin={align:alignToOrigin,settle:settleInitialOrigin,origin:mobileOrigin};
