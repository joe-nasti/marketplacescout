import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const utility=read('src/core/mobile-utility-origin.js');
const app=read('src/app.js');
const route=read('src/modules/scout/route-state.js');
const scoutIndex=read('src/modules/scout/index.js');

// Route/history ownership is intentionally co-located with the already-eager
// mobile utility module so navigation does not add another startup JS request.
const nav=utility;
const utilityInstaller=utility.slice(
  utility.indexOf('export function installMobileUtilityOrigin'),
  utility.indexOf('/* Canonical route/history controller')
);

const failures=[];
const expect=(ok,message)=>{if(!ok)failures.push(message)};

const utilityImport=app.indexOf("import './core/mobile-utility-origin.js';");
const shellImport=app.indexOf("import { startShell } from './core/shell.js';");
expect(utilityImport>=0&&shellImport>=0&&utilityImport<shellImport,'canonical navigation controller must load before the app shell');
expect(nav.includes("history.back()"),'transient UI must unwind through browser history');
expect(nav.includes("scrollRestoration='manual'"),'navigation controller must own route scroll restoration');
expect(nav.includes("dataset.collectishSystemGestures='native'"),'native system gesture ownership marker is missing');
expect(route.includes("push?'pushState':'replaceState'"),'Scout detail state must be able to create a browser history entry');
expect(route.includes("p.delete('tab')"),'Scout must remain the canonical default route instead of writing ?tab=scout');
expect(route.includes("closeScoutDetail"),'Scout route reconciliation must close detail when sku state disappears');
expect(!utilityInstaller.includes("touchstart"),'utility shelf must not duplicate Pointer Events with touchstart');
expect(!utilityInstaller.includes("touchend"),'utility shelf must not duplicate Pointer Events with touchend');
expect(!utilityInstaller.includes("collectish:page-change"),'utility shelf must not override per-route scroll restoration');
expect(!scoutIndex.includes("detail-swipe.js"),'global horizontal detail swipe must stay retired from Scout');

if(failures.length){
  console.error('Navigation contract check failed:');
  for(const failure of failures)console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Navigation contract check passed.');
