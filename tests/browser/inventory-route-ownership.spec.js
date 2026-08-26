import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Inventory route owns Action queue and Workspace without a visibility shim',async()=>{
  const source=await read('src/modules/seller/inventory.js');
  expect(source).toContain("actions.id='cxInventoryActions'");
  expect(source).toContain("workspace.id='cxInventoryWorkspace'");
  expect(source).toContain('function syncMode()');
  expect(source).toContain("actions.hidden=mode!=='actions'");
  expect(source).toContain("workspace.hidden=mode!=='workspace'");
  const index=await read('src/modules/seller/inventory-index.js');
  expect(index).not.toContain('inventory-dense');
  expect(index).not.toContain('inventory-vnext');
});

test('Inventory action queue reuses canonical route data instead of refetching context',async()=>{
  const source=await read('src/modules/seller/inventory.js');
  const view=await read('src/modules/seller/inventory-action-view.js');
  expect(source).toContain('renderInventoryActions({products:rows,conditions:conditionRows,scoutByProduct,salesByProduct');
  expect(source).toContain('direct_net_est,avg_daily_qty_sold,latest_scan_at');
  expect(view).not.toContain("from '../../core/rest.js'");
  expect(view).not.toContain('store.get()');
});

test('Inventory first useful paint does not wait for Scout or Seller cross-source context',async()=>{
  const source=await read('src/modules/seller/inventory.js');
  const loadStart=source.indexOf('async function loadStored()');
  const loadEnd=source.indexOf('\nfunction stat(',loadStart);
  const load=source.slice(loadStart,loadEnd);
  expect(load).toContain("contextStatus:'loading'");
  expect(load).toContain('render();');
  expect(load).toContain("collectish:inventory-core-rendered");
  expect(load).toContain('void loadCrossSource(');
  expect(load).toContain("collectish:inventory-context-ready");
  expect(load.indexOf('render();')).toBeLessThan(load.indexOf('void loadCrossSource('));
  expect(load).not.toContain('await loadCrossSource(');
});

test('Inventory cross-source completion refreshes owned surfaces without rebuilding the route',async()=>{
  const source=await read('src/modules/seller/inventory.js');
  const loadStart=source.indexOf('async function loadStored()');
  const loadEnd=source.indexOf('\nfunction stat(',loadStart);
  const load=source.slice(loadStart,loadEnd);
  expect(load).toContain("syncState({contextStatus:'ready'})");
  expect(load).toContain('renderActions();');
  expect(load).toContain('if(selectedProductId)renderDetail();');
  expect(load.match(/render\(\);/g)?.length).toBe(1);
});
