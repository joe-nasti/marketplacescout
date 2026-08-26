import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Seller route updates do not destroy buyer and cashflow enhancer siblings',async()=>{
  const source=await read('src/modules/seller/orders.js');
  expect(source).toContain("const route=()=>document.getElementById('cxSellerRoute')");
  expect(source).toContain('if(r)return r');
  expect(source).toContain("r.innerHTML=nav()");
  expect(source).not.toContain("host.innerHTML=nav()");
  expect(source).not.toContain('MutationObserver');
  const index=await read('src/modules/seller/index.js');
  expect(index).toContain("import('./cashflow-budget.js')");
  expect(index).toContain("import('./buyer-account.js')");
  expect(index).not.toContain("import('./dashboard-vnext.js')");
});
