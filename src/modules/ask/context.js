// Canonical Ask Collectish UI context. Keep entity identity independent from prompt text.
(() => {
  if(window.CollectishContext)return;
  const remembered={};
  const activeScreen=()=>String(document.querySelector('.cx-page.active')?.id||'').replace(/^cx/,'').toLowerCase()||'unknown';
  function scout(){
    const card=document.querySelector('#cxParityCards .cx-scout-card.selected');
    const sku=card?.dataset?.sku||remembered.scout?.sku_id||null;
    const name=card?.querySelector('.cx-scout-card-body>strong')?.textContent?.trim()
      ||document.querySelector('#cxParityDetail .cx-v5-title .cx-section-title')?.textContent?.trim()
      ||remembered.scout?.product_name||null;
    const href=document.querySelector('#cxParityDetail a[href*="tcgplayer.com/product/"]')?.getAttribute('href')||'';
    const product=(/\/product\/(\d+)/.exec(href)||[])[1]||card?.dataset?.product||remembered.scout?.product_id||null;
    const detail=document.querySelector('#cxParityDetail');
    const setName=detail?.querySelector('[data-set-name]')?.dataset?.setName||remembered.scout?.set_name||null;
    return {type:'mtg_sku',sku_id:sku,product_id:product,product_name:name,set_name:setName};
  }
  function current(){
    const screen=activeScreen();let entity=null;
    if(screen==='scout')entity=scout();
    else if(remembered[screen])entity={...remembered[screen]};
    return {screen,entity,view:{tab:document.querySelector('.cx-page.active [aria-selected="true"]')?.textContent?.trim()||null}};
  }
  function remember(screen,entity){if(screen&&entity)remembered[String(screen).toLowerCase()]={...(remembered[String(screen).toLowerCase()]||{}),...entity}}
  function legacy(){const c=current(),e=c.entity||{};return {screen:c.screen,sku_id:e.sku_id||null,product_id:e.product_id||null,product_name_hint:e.product_name||null,set_name:e.set_name||null,entity:e,view:c.view}}
  window.CollectishContext={current,legacy,remember};
})();