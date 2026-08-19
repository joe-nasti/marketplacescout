let installed=false;
export async function install(){if(installed)return;installed=true;await import('./orders.js');await import('./order-meta.js');await import('./filters.js');await import('./drilldowns.js');await import('./detail-polish.js')}
