import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Sealed renderer is the sole structural list owner',async()=>{
  const [index,renderer]=await Promise.all([
    read('src/modules/sealed/index.js'),
    read('src/modules/sealed/renderer.js')
  ]);
  expect(index).toContain("import('./renderer.js')");
  expect(index).not.toContain("import('./dense-list.js')");
  expect(renderer).toContain('function renderRows()');
  expect(renderer).toContain('cx-sealed-row');
});

test('Admin establishes console before additive diagnostics',async()=>{
  const [index,lazy]=await Promise.all([
    read('src/modules/admin/index.js'),
    read('src/core/lazy-pages.js')
  ]);
  const consoleAt=index.indexOf("await import('./console.js')");
  const alertsAt=index.indexOf("import('./alerts.js')");
  expect(consoleAt).toBeGreaterThan(-1);
  expect(alertsAt).toBeGreaterThan(consoleAt);
  expect(lazy).toContain("h.setAttribute('aria-busy','true')");
  expect(lazy).not.toContain('data-cx-lazy-placeholder');
});
