import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Seller operating cards survive dashboard hidden-state ownership',async()=>{
  const source=await read('src/modules/seller/index.js');
  expect(source).toContain("'cxSellerCashflowBudget'");
  expect(source).toContain("'cxBuyerAccountImport'");
  expect(source).toContain("attributeFilter:['hidden']");
  expect(source).toContain("if(el?.hidden)el.hidden=false");
  expect(source).toContain("el.dataset.sellerPersistent='1'");
});
