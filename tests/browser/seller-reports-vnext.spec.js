import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const reportPath=path.join(process.cwd(),'src/modules/seller/reports-vnext.js');
const indexPath=path.join(process.cwd(),'src/modules/seller/index.js');

test('Seller Reports vNext keeps report data semantic while enforcing dense mobile presentation',async()=>{
  const source=await readFile(reportPath,'utf8');
  const index=await readFile(indexPath,'utf8');
  expect(index).toContain("import('./reports-vnext.js')");
  expect(source).toContain("collectish:seller-tab-rendered");
  expect(source).toContain("cx-sellr-orders");
  expect(source).toContain("cx-sellr-products");
  expect(source).toContain("cx-sellr-refunds");
  expect(source).toContain("cx-sellr-reviews");
  expect(source).toContain("cx-sellr-payments");
  expect(source).toContain("cx-sellr-ris");
  expect(source).toContain("overflow-x:auto!important");
  expect(source).toContain("border-radius:0!important");
  expect(source).toContain("-webkit-line-clamp:2");
  expect(source).toContain("td[data-label=\"Review\"].cx-sellr-empty");
  expect(source).toContain('var(--color-bg-surface)');
  expect(source).toContain('var(--color-text-primary)');
  expect(source).toContain('var(--color-border)');
});
