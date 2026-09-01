import fs from 'node:fs';
const api=fs.readFileSync('supabase/functions/ask-collectish-api/index.ts','utf8');
const bridge=fs.readFileSync('src/modules/ask/surface-persistence.js','utf8');
const modules=fs.readFileSync('src/modules/index.js','utf8');
for(const token of ['MAX_SURFACE_METADATA_BYTES=64*1024','durableSurfaces','surfaces_truncated','surface_total','persistLatestAssistantSurfaces']){
  if(!api.includes(token))throw new Error(`missing Ask surface persistence API token: ${token}`);
}
if(!/saveMessage\(t,cid,'assistant'[\s\S]*surfaces:durable\.surfaces/.test(api))throw new Error('deterministic assistant surfaces are not persisted');
if(!/Array\.isArray\(r\?\.surfaces\)[\s\S]*persistLatestAssistantSurfaces/.test(api))throw new Error('orchestrated assistant surfaces are not persisted');
for(const token of ['window.__CollectishAskSurfaceQueue.length=0','metadata.surfaces','persisted:true']){
  if(!bridge.includes(token))throw new Error(`missing Ask restore bridge token: ${token}`);
}
const boot="await import('./ask/structured-surfaces.js');await import('./ask/surface-persistence.js');await import('./ask/main.js')";
if(!modules.includes(boot))throw new Error('surface persistence must load after renderer and before Ask main');
console.log('Ask surface persistence guard passed');
