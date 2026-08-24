import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Seller dashboard does not hide buyer and cashflow operating cards',async()=>{
  const source=await read('src/modules/seller/dashboard-vnext.js');
  expect(source).toContain("'cxSellerCashflowBudget'");
  expect(source).toContain("'cxBuyerAccountImport'");
  expect(source).toContain('!persistentSellerIds.has(el.id)');
  expect(source).toContain('if(el)el.hidden=false');
  expect(source).not.toContain('MutationObserver');
});
