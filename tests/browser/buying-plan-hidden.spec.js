import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('allocation and buying-plan surfaces remain dormant across Scout, Ask, Seller and Inventory',async()=>{
  const [modules,styles,ask,seller,inventory]=await Promise.all([
    read('src/modules/index.js'),
    read('src/modules/scout/structure-style.js'),
    read('src/modules/ask/actions.js'),
    read('src/modules/seller/index.js'),
    read('src/modules/seller/inventory-index.js')
  ]);
  expect(modules).not.toContain("import('./scout/portfolio-allocation.js')");
  expect(styles).toContain('#cxScout #cxScoutBudgetStrip{display:none!important}');
  expect(styles).not.toContain('cx-scout-view-allocate');
  expect(ask).not.toContain("actions.push(['Build purchase list'");
  expect(ask).not.toContain("actions.push(['Latest purchase list'");
  expect(seller).not.toContain("import('./cashflow-budget.js')");
  expect(inventory).not.toContain("import('./cashflow-budget.js')");
});
