import fs from 'node:fs';

const source=fs.readFileSync('src/modules/index.js','utf8');
const endpoint="await import('./ask/endpoint-proxy.js')";
const surfaces="await import('./ask/structured-surfaces.js')";
const main="await import('./ask/main.js')";
for(const token of [endpoint,surfaces,main]){
  if(!source.includes(token))throw new Error(`Missing required Ask boot import: ${token}`);
}
const endpointAt=source.indexOf(endpoint),surfacesAt=source.indexOf(surfaces),mainAt=source.indexOf(main);
if(!(endpointAt<surfacesAt&&surfacesAt<mainAt)){
  throw new Error('Ask boot order must be endpoint-proxy -> structured-surfaces -> main');
}
const start=source.indexOf('const askEnhancers=['),end=source.indexOf('];',start);
if(start<0||end<0)throw new Error('askEnhancers block not found');
const enhancers=source.slice(start,end);
if(enhancers.includes('structured-surfaces.js')){
  throw new Error('structured-surfaces.js must not be deferred as an idle Ask enhancer');
}
console.log('Ask structured surfaces load before chat: OK');
