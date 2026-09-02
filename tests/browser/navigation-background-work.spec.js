import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Signals navigation reads cached evaluations without recomputing them',async()=>{
  const source=await read('src/modules/signals/market-evaluation.js');
  expect(source).toContain("if(recompute)await rest('rpc/refresh_market_intel_evaluations'");
  expect(source).toContain("if(e.detail?.page==='signals')queueMicrotask(()=>void refresh())");
  expect(source).toContain("document.addEventListener('collectish:intel-changed',queueRecompute)");
});

test('optional background requests wait until navigation is idle',async()=>{
  const detail=await read('src/modules/scout/detail-navigation.js');
  const search=await read('src/modules/scout/on-demand-sku-discovery.js');
  const alerts=await read('src/modules/admin/alerts.js');
  expect(detail).toContain("requestIdleCallback(run,{timeout:5000})");
  expect(search).toContain("requestIdleCallback(run,{timeout:5000})");
  expect(alerts).toContain("requestIdleCallback(run,{timeout:3000})");
  expect(alerts).toContain('if(permissionDenied(e))');
});
