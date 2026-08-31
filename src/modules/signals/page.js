import * as core from './index.js';

export async function install(){
  await core.install();
  const sl=await import('./secret-lair-surface.js');
  await sl.install();
  const market=await import('./secret-lair-market-status.js');
  await market.install();
  const lifecycle=await import('./secret-lair-row-lifecycle.js');
  await lifecycle.install();
  const details=await import('./secret-lair-row-details.js');
  await details.install();
}
