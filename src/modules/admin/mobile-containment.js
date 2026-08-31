// Hard mobile containment for the Admin > Singles operations surface.
// Individual diagnostics are authored independently; this layer guarantees that
// none of them can turn the Admin route into a document-sized horizontal canvas.
(() => {
  const id='cxAdminSinglesMobileContainment';
  if(!document.getElementById(id)){
    const style=document.createElement('style');
    style.id=id;
    style.textContent=`
      @media(max-width:700px){
        html.cx-admin-singles-contained,html.cx-admin-singles-contained body{width:100%!important;max-width:100vw!important;overflow-x:clip!important}
        html.cx-admin-singles-contained #cxAdmin,
        html.cx-admin-singles-contained #cxAdminConsole,
        html.cx-admin-singles-contained [data-admin-panel="singles"],
        html.cx-admin-singles-contained #cxAdminSinglesSummary,
        html.cx-admin-singles-contained #cxAdminSinglesModules,
        html.cx-admin-singles-contained #cxAdminSinglesModules>.cx-admin-module,
        html.cx-admin-singles-contained #cxAdminSinglesModules>.cx-marketplace-health,
        html.cx-admin-singles-contained #cxAdminSinglesModules>#cxAdminScanConfig{
          width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;overflow-x:clip!important
        }
        html.cx-admin-singles-contained [data-admin-panel="singles"] *{box-sizing:border-box;min-width:0;max-width:100%}
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-module,
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-subsection{width:100%!important;overflow-x:clip!important}
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-module-head{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:start!important;gap:8px!important;width:100%!important}
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-module-head>div{min-width:0!important}
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-module-head h3,
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-module-head h4,
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-module-head p,
        html.cx-admin-singles-contained [data-admin-panel="singles"] strong,
        html.cx-admin-singles-contained [data-admin-panel="singles"] small,
        html.cx-admin-singles-contained [data-admin-panel="singles"] p{overflow-wrap:anywhere;word-break:normal}
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-list-row{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:7px!important;width:100%!important;max-width:100%!important;min-width:0!important;overflow:hidden!important}
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-list-row>div{width:100%!important;max-width:100%!important;min-width:0!important}
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-actions,
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-discovery-filters{display:flex!important;flex-wrap:wrap!important;gap:5px!important;width:100%!important;max-width:100%!important}
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-admin-actions button,
        html.cx-admin-singles-contained [data-admin-panel="singles"] .cx-discovery-filters button{flex:0 1 auto!important;white-space:normal!important}
        html.cx-admin-singles-contained [data-admin-panel="singles"] pre,
        html.cx-admin-singles-contained [data-admin-panel="singles"] code,
        html.cx-admin-singles-contained [data-admin-panel="singles"] table{max-width:100%!important;overflow-x:auto!important}
        html.cx-admin-singles-contained [data-admin-panel="singles"] img,
        html.cx-admin-singles-contained [data-admin-panel="singles"] svg{max-width:100%!important;height:auto}
      }
    `;
    document.head.appendChild(style);
  }

  const resetHorizontal=()=>{
    const scrolling=document.scrollingElement||document.documentElement;
    if(scrolling)scrolling.scrollLeft=0;
    document.documentElement.scrollLeft=0;
    document.body.scrollLeft=0;
  };
  const sync=(section)=>{
    const singles=section?section==='singles':document.getElementById('cxAdminConsole')?.dataset.activeSection==='singles';
    document.documentElement.classList.toggle('cx-admin-singles-contained',Boolean(singles));
    if(singles){
      resetHorizontal();
      requestAnimationFrame(resetHorizontal);
      setTimeout(resetHorizontal,80);
    }
  };

  document.addEventListener('collectish:admin-section-change',e=>sync(e.detail?.section));
  document.addEventListener('collectish:admin-modules-ready',()=>sync());
  window.addEventListener('resize',()=>sync());
  sync();
})();
