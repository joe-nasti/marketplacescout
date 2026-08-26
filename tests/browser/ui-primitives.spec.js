import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const primitivesPath=path.join(process.cwd(),'src/core/ui-primitives.js');
const adoptionPath=path.join(process.cwd(),'src/core/ui-adoption.js');

test('shared vNext primitives stay theme-token driven',async()=>{
  const source=await readFile(primitivesPath,'utf8');
  expect(source).toContain('var(--color-border)');
  expect(source).toContain('var(--color-bg-surface)');
  expect(source).toContain('var(--color-success)');
  expect(source).toContain('var(--color-warning)');
  expect(source).toContain('var(--color-danger)');
  expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
});

test('Signals Inventory and Seller adopt shared shell primitives',async()=>{
  const source=await readFile(adoptionPath,'utf8');
  expect(source).toContain("#cxSignalsNav");
  expect(source).toContain("#cxSignalsScan .cx-sv-metrics");
  expect(source).toContain("#cxInventoryVnext .cx-iv-nav");
  expect(source).toContain("#cxSellerRoute .cx-sellv-nav");
  expect(source).toContain("'cx-ui-tabs'");
  expect(source).toContain("'cx-ui-metrics'");
  expect(source).toContain("'cx-ui-list'");
  expect(source).toContain("'cx-ui-status'");
  expect(source).not.toContain('#cxSignalsVnext');
  expect(source).not.toContain('#cxSellerVnext');
});
