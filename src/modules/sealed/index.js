let installed=false;
export async function install(){if(installed)return;installed=true;await import('./renderer.js');await import('./detail-focus.js')}
