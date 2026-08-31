import * as core from './index.js';

export async function install(){
  await core.install();
  const sl=await import('./secret-lair-surface.js');
  await sl.install();
}
