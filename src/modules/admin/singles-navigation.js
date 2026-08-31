// Admin > Singles information architecture and browser-history navigation.
// Each meaningful Admin view receives a URL state so Android/browser back gestures
// unwind local navigation before leaving Admin.
(() => {
  const ADMIN_SECTIONS=new Set(['overview','singles','sealed','system']);
  const SINGLES_VIEWS=new Set(['scanning','scout','signals']);
  const NOTES={
    scanning:'Marketplace admission, scan health, and per-set scan configuration.',
    scout:'Scout universe coverage and catalyst calibration.',
    signals:'Signal outcomes, creator quality, and the YouTube evaluation pipeline.'
  };
  let singlesView='scanning',lastApplied='';

  function stateFromUrl(){
    const p=new URL(location.href).searchParams;
    const section=ADMIN_SECTIONS.has(p.get('admin'))?p.get('admin'):'overview';
    const view=SINGLES_VIEWS.has(p.get('singles'))?p.get('singles'):'scanning';
    return {section,view};
  }

  function writeState(section,view,{replace=false}={}){
    const u=new URL(location.href),p=u.searchParams;
    if(section==='overview')p.delete('admin');else p.set('admin',section);
    if(section==='singles'&&view!=='scanning')p.set('singles',view);else p.delete('singles');
    const next=`${u.pathname}${p.toString()?`?${p}`:''}${u.hash}`;
    const current=`${location.pathname}${location.search}${location.hash}`;
    if(next===current)return;
    history[replace?'replaceState':'pushState']({},'',next);
  }

  function ensureSubnav(){
    let shell=document.getElementById('cxAdminConsole');
    if(!shell){window.CollectishAdminConsole?.render?.();shell=document.getElementById('cxAdminConsole')}
    const panel=shell?.querySelector('[data-admin-panel="singles"]');
    if(!panel)return null;
    let nav=panel.querySelector('#cxAdminSinglesSubnav');
    if(!nav){
      nav=document.createElement('nav');
      nav.id='cxAdminSinglesSubnav';
      nav.className='cx-admin-ia-subnav cx-admin-singles-subnav';
      nav.setAttribute('aria-label','Singles operations');
      nav.innerHTML='<button type="button" data-admin-singles-view="scanning">Scanning</button><button type="button" data-admin-singles-view="scout">Scout</button><button type="button" data-admin-singles-view="signals">Signals</button>';
      const note=document.createElement('p');note.id='cxAdminSinglesViewNote';note.className='cx-admin-ia-section-note cx-admin-singles-note';
      const summary=panel.querySelector('#cxAdminSinglesSummary');
      summary?.insertAdjacentElement('afterend',nav);nav.insertAdjacentElement('afterend',note);
      nav.addEventListener('click',e=>{
        const b=e.target.closest('[data-admin-singles-view]');if(!b)return;
        selectView(b.dataset.adminSinglesView,{history:true,scroll:true});
      });
    }
    return nav;
  }

  function setVisible(selector,visible){document.querySelectorAll(selector).forEach(el=>{el.hidden=!visible})}

  function applyView({emit=true}={}){
    const nav=ensureSubnav();if(!nav)return;
    nav.querySelectorAll('[data-admin-singles-view]').forEach(b=>b.classList.toggle('active',b.dataset.adminSinglesView===singlesView));
    const panel=nav.closest('[data-admin-panel="singles"]');if(panel)panel.dataset.singlesView=singlesView;
    const note=document.getElementById('cxAdminSinglesViewNote');if(note)note.textContent=NOTES[singlesView]||'';
    const scanning=singlesView==='scanning',scout=singlesView==='scout',signals=singlesView==='signals';
    setVisible('#cxAdminSinglesModules > .cx-marketplace-health',scanning);
    setVisible('#cxAdminSinglesModules > #cxAdminScanConfig',scanning);
    setVisible('#cxAdminSinglesModules > #cxScoutUniverseAdmin',scout);
    setVisible('#cxAdminSinglesModules > #cxCatalystCalibration',scout);
    setVisible('#cxAdminSinglesModules > #cxSignalsVideoAuditAdmin',signals);
    setVisible('#cxAdminSinglesModules > #cxYoutubePipelineAdmin',signals);
    setVisible('#cxAdminSinglesModules > #cxSecretLairAdmin',signals);
    const signature=`${document.getElementById('cxAdminConsole')?.dataset.activeSection||''}:${singlesView}`;
    if(emit&&signature!==lastApplied){lastApplied=signature;document.dispatchEvent(new CustomEvent('collectish:admin-singles-view-change',{detail:{view:singlesView}}))}
  }

  function scrollToSubnav(){if(!matchMedia('(max-width:700px)').matches)return;requestAnimationFrame(()=>document.getElementById('cxAdminSinglesSubnav')?.scrollIntoView({block:'start',behavior:'smooth'}))}
  function selectView(view,{history:push=false,scroll=false}={}){singlesView=SINGLES_VIEWS.has(view)?view:'scanning';applyView();if(push)writeState('singles',singlesView);if(scroll)scrollToSubnav()}

  function syncFromUrl({recover=false}={}){
    if(new URL(location.href).searchParams.get('tab')!=='admin')return;
    const {section,view}=stateFromUrl();singlesView=view;
    let shell=document.getElementById('cxAdminConsole');
    if(!shell&&recover){window.CollectishAdminConsole?.render?.();shell=document.getElementById('cxAdminConsole');document.dispatchEvent(new CustomEvent('collectish:admin-modules-ready'))}
    if(!shell)return;
    if(shell.dataset.activeSection!==section)window.CollectishAdminConsole?.show?.(section,false);
    ensureSubnav();applyView({emit:false});
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('#cxAdminConsole [data-admin-tab]');if(!b)return;
    const section=ADMIN_SECTIONS.has(b.dataset.adminTab)?b.dataset.adminTab:'overview';
    const previous=stateFromUrl().section;
    if(section==='singles'&&previous!=='singles'){singlesView='scanning';applyView()}
    writeState(section,section==='singles'?singlesView:'scanning');
  });
  document.addEventListener('collectish:admin-modules-ready',()=>{ensureSubnav();applyView({emit:false})});
  document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles'){ensureSubnav();applyView({emit:false})}});
  document.addEventListener('collectish:admin-singles-content-changed',()=>{if(document.getElementById('cxAdminConsole')?.dataset.activeSection==='singles')applyView({emit:false})});
  window.addEventListener('popstate',()=>setTimeout(()=>syncFromUrl({recover:true}),0));

  const style=document.createElement('style');style.id='cxAdminSinglesNavigationStyle';style.textContent=`
    .cx-admin-singles-subnav{margin:0!important;padding:2px 0 0}.cx-admin-singles-note{margin:0!important}.cx-admin-singles-subnav button{min-width:92px;text-align:center}
    @media(max-width:700px){.cx-admin-singles-subnav{position:sticky!important;top:48px!important;z-index:19!important;background:var(--color-bg-primary)!important;padding:7px 0 6px!important;margin:0!important;overflow-x:visible!important;box-shadow:0 8px 14px -14px var(--color-overlay)}.cx-admin-singles-subnav button{flex:1 1 0!important;min-width:0!important;padding:8px 7px!important;font-size:10px!important}.cx-admin-singles-note{font-size:9px!important;line-height:1.3!important;padding:1px 1px 2px}}
  `;if(!document.getElementById(style.id))document.head.appendChild(style);

  ensureSubnav();syncFromUrl();
  window.CollectishAdminSinglesNavigation={show:view=>selectView(view,{history:true,scroll:true}),state:()=>({view:singlesView})};
})();
