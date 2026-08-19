let installed=false;
export async function installScoutRenderer(){if(installed)return;installed=true;await import('./renderer.js')}
export default installScoutRenderer;
