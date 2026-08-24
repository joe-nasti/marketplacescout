let installed=false;
export async function installScoutRenderer(){
  if(installed)return;
  installed=true;
  await import('./first-paint-guard.js');
  await import('./renderer.js');
  await import('./detail-navigation.js');
  await import('./ia-v2-style.js');
  await import('./ia-v2.js');
  await import('./score-explain.js');
}
export default installScoutRenderer;
