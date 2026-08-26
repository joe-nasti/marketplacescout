let installed=false;

export async function installScoutRenderer(){
  if(installed)return;
  installed=true;

  // Install the paint guard and structural controllers before the renderer can
  // emit its first list/ready events. This avoids painting a legacy/base Scout
  // and then visibly reshaping it into the promoted information architecture.
  await import('./first-paint-guard.js');
  await Promise.all([
    import('./ia-v2-style.js'),
    import('./ia-v2.js'),
    import('./compact-mobile.js'),
    import('./dense-list.js')
  ]);

  // The promoted renderer owns first useful content.
  await import('./renderer.js');
  document.dispatchEvent(new CustomEvent('collectish:scout-structure-ready'));

  // Detail navigation and explanation are interaction enhancers. They do not
  // participate in composing the first Scout surface.
  void Promise.all([
    import('./detail-navigation.js'),
    import('./score-explain.js')
  ]).then(()=>document.dispatchEvent(new CustomEvent('collectish:scout-interactions-ready')));
}

export default installScoutRenderer;
