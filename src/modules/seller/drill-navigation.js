let installed=false;

function focusQuery(id,value){
  const input=document.getElementById(id);
  if(!input)return false;
  input.value=value||'';
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.focus();
  return true;
}
async function openOrder(order){
  await window.CollectishSeller?.setMode?.('reports','orders');
  queueMicrotask(()=>focusQuery('cxSellerOrderSearch',order));
}
async function openProduct(name){
  await window.CollectishSeller?.setMode?.('reports','products');
  queueMicrotask(()=>focusQuery('cxSellerProductSearch',name));
}
function click(event){
  const order=event.target.closest?.('#cxSeller [data-sellv-order]');
  if(order){
    event.preventDefault();
    event.stopImmediatePropagation();
    void openOrder(order.dataset.sellvOrder);
    return;
  }
  const product=event.target.closest?.('#cxSeller [data-sellv-product]');
  if(product){
    event.preventDefault();
    event.stopImmediatePropagation();
    void openProduct(product.dataset.sellvProduct);
  }
}

export function installSellerDrillNavigation(){
  if(installed)return;
  installed=true;
  document.addEventListener('click',click,true);
}

installSellerDrillNavigation();
window.CollectishSellerDrillNavigation={openOrder,openProduct};
