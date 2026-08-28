import { test, expect } from '@playwright/test';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Signals scan keeps Feed explicit and removes fake More filters route',async()=>{
  const source=await read('src/modules/signals/dense-vnext.js');
  expect(source).toContain('data-sv-mode="feed"');
  expect(source).not.toContain('data-sv-more');
  expect(source).toContain('cx-ui-tabs');
  expect(source).toContain('cx-ui-metrics');
  expect(source).toContain('cx-ui-list');
});

test('Sealed dense scan exposes actionable summary filters and shared primitives',async()=>{
  const source=await read('src/modules/sealed/dense-list.js');
  expect(source).toContain('Buylist backed');
  expect(source).toContain('Positive spread');
  expect(source).toContain('data-sealed-dense-filter');
  expect(source).toContain('cx-ui-metrics');
  expect(source).toContain('cx-ui-status');
  expect(source).toContain('cx-ui-list');
});

test('SYP dense scan adopts shared shell primitives without changing its evidence rules',async()=>{
  const source=await read('src/modules/seller/syp-dense-vnext.js');
  expect(source).toContain('Direct scarce');
  expect(source).toContain('High velocity');
  expect(source).toContain('cx-ui-tabs');
  expect(source).toContain('cx-ui-metrics');
  expect(source).toContain('cx-ui-status');
  expect(source).toContain('cx-ui-list');
});

test('retired Admin presentation writers are physically removed',async()=>{
  await expect(access(path.join(root,'src/modules/admin/overview-vnext.js'))).rejects.toThrow();
  await expect(access(path.join(root,'src/modules/admin/fixed-nav.js'))).rejects.toThrow();
  const index=await read('src/modules/admin/index.js');
  expect(index).not.toContain('overview-vnext');
  expect(index).not.toContain('fixed-nav');
});

test('final hardening remains theme-token driven',async()=>{
  const inlineSealed=await read('src/modules/sealed/dense-list.js');
  const sharedCss=await read('src/styles/ui-vnext-primitives.css');
  const signalsCss=await read('src/styles/signals.css');
  const sellerCss=await read('src/styles/seller.css');
  for(const source of [inlineSealed,sharedCss,signalsCss,sellerCss]){
    expect(source).toContain('var(--color-');
  }
  expect(inlineSealed).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});

test('secondary workbench migration covers Sealed Admin and Ask on desktop and mobile',async()=>{
  const css=await read('src/core/workbench-secondary.css');
  const app=await read('src/app.js');
  for(const selector of ['.cx-sealed-layout','#cxAdminConsole','.cx-ask-panel'])expect(css).toContain(selector);
  expect(css).toContain('@media(max-width:700px)');
  expect(css).toContain('env(safe-area-inset-bottom)');
  expect(app).toContain("import './core/workbench-secondary.css';");
});
