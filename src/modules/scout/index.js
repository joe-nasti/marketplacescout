let installed=false;
export async function installScoutRenderer(){
  if(installed)return;
  installed=true;
  await import('./renderer.js');
  await import('./ia-v2-style.js');
  await import('./ia-v2.js');
}
export default installScoutRenderer;
