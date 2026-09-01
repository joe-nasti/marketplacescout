import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=file=>readFile(path.join(process.cwd(),file),'utf8');

test('secondary entry modules do not block Collectish startup',async()=>{
  const source=await read('src/main.js');
  const start=source.indexOf("import('./app.js').then(app=>app.startCollectish())");
  const deferred=source.indexOf("document.addEventListener('collectish:ready',installSecondaryEntryModules");
  expect(start).toBeGreaterThan(-1);
  expect(deferred).toBeGreaterThan(-1);
  expect(source).not.toContain("Promise.all([\n    import('./app.js')");
});

test('startup hydrates the cache Scout actually consumes and defers feature enhancers',async()=>{
  const source=await read('src/app.js');
  expect(source).toContain("key:'scout.rows.actionability-v1'");
  expect(source).not.toContain("key:'scout.rows',scope:'user'");
  expect(source).toContain("document.addEventListener('collectish:scout-v5-ready',run");

  const beforeReady=source.slice(source.indexOf('startShell({beforeReady:'),source.indexOf('scheduleIdlePrime();'));
  expect(beforeReady).not.toContain('await installModules()');
});
