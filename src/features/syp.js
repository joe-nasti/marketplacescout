let installed=false;

export async function install(){
  if(installed)return;
  installed=true;
  await import('../../current-syp-parity.js');
  await import('../../current-syp-links.js');
}
