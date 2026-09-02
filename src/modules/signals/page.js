import * as core from './index.js';

let secretLairPromise=null;

function placeholder(){
  const host=document.getElementById('cxSignals');if(!host)return;
  let box=document.getElementById('cxSecretLairSignals');
  if(!box){box=document.createElement('section');box.id='cxSecretLairSignals';box.className='cx-sl-event';const head=host.querySelector('.cx-page-head');if(head?.nextSibling)host.insertBefore(box,head.nextSibling);else host.prepend(box)}
  box.hidden=host.dataset.signalsView!=='secret-lair';
  if(!box.innerHTML)box.innerHTML='<div class="cx-sl-empty">Preparing Secret Lair intelligence…</div>';
}

function loadSecretLair(){
  if(secretLairPromise)return secretLairPromise;
  placeholder();
  const installers=[
    ()=>import('./secret-lair-surface.js'),
    ()=>import('./secret-lair-market-status.js'),
    ()=>import('./secret-lair-row-lifecycle.js'),
    ()=>import('./secret-lair-row-details.js'),
    ()=>import('./secret-lair-forward-test.js'),
    ()=>import('./secret-lair-zeta.js')
  ];
  secretLairPromise=Promise.all(installers.map(importer=>importer().then(module=>module.install()))).catch(error=>{
    secretLairPromise=null;
    console.warn('Collectish Secret Lair surface failed',error);
  });
  return secretLairPromise;
}

function scheduleSecretLair(){
  const run=()=>void loadSecretLair();
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:5000});else setTimeout(run,2200);
}

export async function install(){
  await core.install();
  document.addEventListener('collectish:signals-view-change',event=>{if(event.detail?.view==='secret-lair')void loadSecretLair()});
  document.addEventListener('pointerover',event=>{if(event.target?.closest?.('[data-signals-mode="secret-lair"]'))void loadSecretLair()},{passive:true});
  document.addEventListener('focusin',event=>{if(event.target?.closest?.('[data-signals-mode="secret-lair"]'))void loadSecretLair()});
  if(document.getElementById('cxSignals')?.dataset.signalsView==='secret-lair')void loadSecretLair();else scheduleSecretLair();
}
