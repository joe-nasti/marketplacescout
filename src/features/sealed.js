let installed=false;

export async function install(){
  if(installed)return;
  installed=true;
  await import('../../current-sealed-generalized-r0991.js');
  await import('../../current-sealed-detail-focus.js');
}
