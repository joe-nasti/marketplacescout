let installed=false;
export async function installScoutRenderer(){
  if(installed)return;
  installed=true;
  await import('./first-paint-guard.js');
  await Promise.all([
    import('./ia-v2-style.js'),
    import('./compact-mobile.js'),
    import('./dense-list.js'),
    import('./ia-v2.js')
  ]);
  await import('./renderer.js');
  await Promise.all([
    import('./detail-navigation.js'),
    import('./score-explain.js')
  ]);
}
export default installScoutRenderer;
