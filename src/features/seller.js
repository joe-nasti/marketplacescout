let installed=false;

export async function install(){
  if(installed)return;
  installed=true;
  await import('../../current-seller-parity.js');
  await import('../../current-seller-overview-order-meta.js');
  await import('../../current-seller-order-filters.js');
  await import('../../current-seller-drilldowns.js');
  await import('../../current-seller-detail-polish.js');
}
