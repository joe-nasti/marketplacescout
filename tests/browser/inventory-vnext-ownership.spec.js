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
  expect(source).not.toContain('cxInventoryVnext');
  const index=await read('src/modules/seller/inventory-index.js');
  expect(index).not.toContain("import('./inventory-dense-vnext.js')");
  expect(index).not.toContain("import('./inventory-vnext-ownership.js')");
});

test('Inventory action queue reuses canonical route data instead of refetching context',async()=>{
  const source=await read('src/modules/seller/inventory.js');
  const view=await read('src/modules/seller/inventory-action-view.js');
  expect(source).toContain('renderInventoryActions({products:rows,conditions:conditionRows,scoutByProduct,salesByProduct');
  expect(source).toContain('direct_net_est,avg_daily_qty_sold,latest_scan_at');
  expect(view).not.toContain("from '../../core/rest.js'");
  expect(view).not.toContain('store.get()');
});
