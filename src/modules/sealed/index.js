let installed=false;
export async function install(){
  if(installed)return;
  installed=true;
  const module=await import('./renderer.js');
  await module.install();
}
