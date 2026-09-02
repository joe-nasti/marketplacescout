import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Signals becomes ready without awaiting the Secret Lair data stack',async()=>{
  const page=await read('src/modules/signals/page.js');
  expect(page).toContain('Promise.all(installers.map(importer=>importer().then(module=>module.install())))');
  expect(page).toContain('collectish:signals-view-change');
  expect(page).toContain('requestIdleCallback');
  expect(page).not.toContain("const sl=await import('./secret-lair-surface.js')");
});

test('Secret Lair and Operations retain user-scoped cached surfaces while refreshing',async()=>{
  const secret=await read('src/modules/signals/secret-lair-surface.js');
  const admin=await read('src/modules/admin/console.js');
  const index=await read('src/modules/admin/index.js');
  expect(secret).toContain("window.CollectishShell?.session?.()?.user?.id||'anonymous'");
  expect(secret).toContain('writeCached(box.innerHTML)');
  expect(admin).toContain("window.CollectishShell?.session?.()?.user?.id||'anonymous'");
  expect(admin).toContain('Updating in background');
  expect(index.indexOf('void window.CollectishAdminConsole?.refresh?.()')).toBeLessThan(index.indexOf("import('./single-owner-style.js')"));
});
