import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Signals route warms after Scout becomes ready',async()=>{
  const source=await read('src/core/lazy-pages.js');
  expect(source).toContain("prefetchPage('signals')");
  expect(source).toContain("document.addEventListener('collectish:scout-v5-ready',scheduleSignalsWarmup,{once:true})");
  expect(source).toContain("requestIdleCallback(run,{timeout:3000})");
});

test('Signals restores a recent scan while fresh data resolves',async()=>{
  const source=await read('src/modules/signals/index.js');
  expect(source).toContain('collectishSignalsScan:');
  expect(source).toContain('SCAN_CACHE_TTL=30*60*1000');
  expect(source).toContain("scan.dataset.cached='1'");
  expect(source).toContain("if(!scanResolved&&!items.length&&!actionable.length&&box.dataset.cached==='1')return");
  expect(source).toContain('writeCachedScan(box.innerHTML)');
});
