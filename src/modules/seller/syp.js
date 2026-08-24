let installed=false;
export async function install(){if(installed)return;installed=true;await import('./syp-freshness.js');await import('./syp-feed.js');await import('./syp-links.js');await import('./syp-dense-vnext.js')}
