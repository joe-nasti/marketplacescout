const css=`
#cxScout .cx-scout-ia{display:grid;gap:8px;margin:0 0 10px}
#cxScout .cx-scout-ia-row{display:flex;align-items:center;gap:8px;min-width:0}
#cxScout .cx-scout-saved-views{display:flex;gap:6px;overflow:auto;min-width:0;flex:1;padding-bottom:2px;scrollbar-width:none}
#cxScout .cx-scout-saved-views::-webkit-scrollbar{display:none}
#cxScout .cx-scout-saved-views button{flex:0 0 auto;border:1px solid var(--color-border);background:var(--color-bg-surface);color:var(--color-text-secondary);border-radius:999px;padding:7px 10px;font-size:11px;font-weight:800;cursor:pointer}
#cxScout .cx-scout-saved-views button.active{border-color:var(--color-accent);background:var(--color-accent-soft);color:var(--color-accent)}
#cxScout .cx-scout-filter-trigger{flex:0 0 auto;white-space:nowrap}
#cxScout .cx-scout-filter-trigger span,#cxScout .cx-scout-search-row [data-scout-filters] span{display:inline-flex;min-width:17px;height:17px;align-items:center;justify-content:center;border-radius:999px;background:var(--color-accent-soft);color:var(--color-accent);font-size:9px;margin-left:4px}
#cxScout .cx-scout-budget-strip{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;width:100%;border:1px solid var(--color-border);border-radius:11px;padding:9px 11px;background:var(--color-bg-surface);color:var(--color-text-primary);text-align:left;cursor:pointer}
#cxScout .cx-scout-budget-strip span,#cxScout .cx-scout-budget-strip small{font-size:9px;color:var(--color-text-secondary)}
#cxScout .cx-scout-budget-strip strong{font-size:11px}
#cxScout .cx-scout-budget-strip small{text-align:right}
#cxScout .cx-scout-toolbar{display:block;margin-bottom:8px}
#cxScout .cx-scout-search-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}
#cxScout .cx-scout-search-row input{min-width:0}
#cxScout .cx-scout-filter-sheet{display:none;position:fixed;z-index:10030;inset:auto 12px max(12px,env(safe-area-inset-bottom));max-height:min(76vh,680px);overflow:auto;border:1px solid var(--color-border);border-radius:18px;background:var(--color-bg-elevated);box-shadow:0 0 0 100vmax var(--color-overlay),var(--shadow-float);padding:14px;color:var(--color-text-primary)}
#cxScout.cx-scout-filters-open .cx-scout-filter-sheet{display:block}
#cxScout .cx-scout-filter-sheet-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
#cxScout .cx-scout-filter-sheet-head strong{font-size:18px}
#cxScout .cx-scout-filter-sheet-head button{width:36px;height:36px;border:1px solid var(--color-border);border-radius:999px;background:var(--color-bg-surface);color:var(--color-text-primary);font-size:23px}
#cxScout #cxScoutFilterSheetBody{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#cxScout #cxScoutFilterSheetBody>select,#cxScout #cxScoutFilterSheetBody>input{width:100%;min-width:0;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text-primary);border-radius:11px;padding:10px}
#cxScout #cxScoutFilterSheetBody>[data-cx-compact-filters]{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:8px}
#cxScout #cxScoutFilterSheetBody>[data-cx-compact-filters]>*{min-width:0;width:100%}
#cxScout .cx-scout-filter-sheet-actions{display:grid;grid-template-columns:110px 1fr;gap:8px;margin-top:14px}
body.cx-scout-filter-lock{overflow:hidden}
#cxScout.cx-scout-view-ranked #cxQuickTurnScout,#cxScout.cx-scout-view-ranked #cxPortfolioAllocation{display:none!important}
#cxScout.cx-scout-view-quick .cx-scout-layout,#cxScout.cx-scout-view-quick #cxPortfolioAllocation{display:none!important}
#cxScout.cx-scout-view-quick #cxQuickTurnScout{display:block!important;margin-top:4px}
#cxScout.cx-scout-view-allocate .cx-scout-layout,#cxScout.cx-scout-view-allocate #cxQuickTurnScout{display:none!important}
#cxScout.cx-scout-view-allocate #cxPortfolioAllocation{display:block!important;margin-top:4px}
#cxScout .cx-scout-decision{display:grid;gap:3px;padding:12px 13px;margin:10px 0 12px;border:1px solid color-mix(in srgb,var(--color-success) 45%,var(--color-border));border-radius:13px;background:color-mix(in srgb,var(--color-success) 8%,var(--color-bg-surface))}
#cxScout .cx-scout-decision small{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:var(--color-success)}
#cxScout .cx-scout-decision strong{font-size:16px;line-height:1.25;color:var(--color-text-primary)}
#cxScout .cx-scout-decision span{font-size:10px;color:var(--color-text-secondary)}
#cxScout .cx-scout-evidence{margin-top:12px;border-top:1px solid var(--color-border);padding-top:10px}
#cxScout .cx-scout-evidence>summary{font-size:14px;font-weight:850;cursor:pointer;color:var(--color-text-primary)}
#cxScout .cx-scout-evidence-body{display:grid;gap:0;margin-top:8px}
#cxScout .cx-scout-evidence-body>.cx-v5-section{margin-top:0;padding-top:12px}
@media(min-width:981px){#cxScout .cx-scout-filter-sheet{left:auto;right:28px;bottom:auto;top:140px;width:420px;max-height:72vh}.cx-scout-saved-views{max-width:760px}}
@media(max-width:700px){
#cxScout .cx-page-head{margin-bottom:10px}
#cxScout .cx-page-head p{display:none}
#cxScout .cx-scout-ia{margin-bottom:7px}
#cxScout .cx-scout-ia-row{align-items:stretch}
#cxScout .cx-scout-saved-views button{padding:6px 9px;font-size:10px}
#cxScout .cx-scout-filter-trigger{padding:7px 9px;font-size:10px}
#cxScout .cx-scout-budget-strip{padding:7px 9px;grid-template-columns:auto 1fr auto}
#cxScout .cx-scout-budget-strip strong{font-size:10.5px}
#cxScout .cx-scout-budget-strip small{font-size:8.5px}
#cxScout .cx-scout-search-row input{height:40px;padding:9px 10px}
#cxScout .cx-scout-search-row button{height:40px;padding:8px 10px}
#cxScout .cx-scout-filter-sheet{left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom));padding-bottom:calc(14px + env(safe-area-inset-bottom))}
#cxScout #cxScoutFilterSheetBody{grid-template-columns:1fr 1fr}
#cxScout.cx-scout-view-quick #cxQuickTurnScout>.cx-page-head,#cxScout.cx-scout-view-allocate #cxPortfolioAllocation>.cx-page-head{margin-top:0}
#cxScout.cx-scout-view-quick #cxQuickTurnScout,#cxScout.cx-scout-view-allocate #cxPortfolioAllocation{border:0;padding:0;background:transparent;box-shadow:none}
#cxScout.cx-scout-view-quick #cxQuickTurnScout .cx-detail-list,#cxScout.cx-scout-view-allocate #cxPortfolioAllocation .cx-detail-list{grid-template-columns:1fr!important}
#cxScout .cx-mobile-detail-open .cx-v5-components{display:none}
#cxScout .cx-mobile-detail-open .cx-scout-hero{width:76px;float:left;margin:0 12px 10px 0}
#cxScout .cx-mobile-detail-open .cx-v5-title{min-height:78px;align-items:flex-start}
#cxScout .cx-mobile-detail-open .cx-scout-decision{clear:both}
#cxScout .cx-mobile-detail-open .cx-scout-execution-primary .cx-section-title{font-size:14px}
#cxScout .cx-mobile-detail-open .cx-scout-why-buy{border-top:1px solid var(--color-border);padding-top:12px}
}
`;
if(!document.getElementById('cxScoutStructureStyle')){const s=document.createElement('style');s.id='cxScoutStructureStyle';s.textContent=css;document.head.appendChild(s)}
