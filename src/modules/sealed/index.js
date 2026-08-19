let installed=false;
export async function install(){
  if(installed)return;
  installed=true;
  await import('./detail-focus.js');
  await import('./cardtrader.js');
  await import('./cardtrader-opportunities.js');
  const module=await import('./renderer.js');
  await module.install();
}