import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Admin Overview has one writer and stable section ownership',async()=>{
  const [index,consoleSource,vnext]=await Promise.all([
    read('src/modules/admin/index.js'),read('src/modules/admin/console.js'),read('src/modules/admin/admin-vnext.js')
  ]);
  expect(index).not.toContain("import('./overview-vnext.js')");
  expect(index).toContain("import('./admin-vnext.js')");
  expect(consoleSource).toContain("const changed=shell.dataset.activeSection!==active");
  expect(consoleSource).toContain("if(changed&&emit)document.dispatchEvent");
  expect(consoleSource).toContain("summary?.insertAdjacentElement('afterend',mh)");
  expect(consoleSource).not.toContain("overview.appendChild(mh)");
  expect(vnext).toContain("Date.now()-opsLoadedAt<60000");
  expect(vnext).toContain("if(!host.dataset.ready)host.innerHTML");
});

test('Admin Singles navigator stays in page flow instead of covering mobile navigation',async()=>{
  const source=await read('src/modules/admin/fixed-nav.js');
  expect(source).toContain("document.querySelector('#cxAdminSinglesModules')");
  expect(source).not.toContain('document.body.appendChild(nav)');
  expect(source).toContain('position:sticky');
  expect(source).not.toContain('position:fixed;left:8px;right:8px;bottom:72px');
  expect(source).not.toContain('cx-admin-fixed-nav-open');
});

test('Admin deep runtime diagnostics are subordinate and theme-token driven',async()=>{
  const [vnext,style]=await Promise.all([read('src/modules/admin/admin-vnext.js'),read('src/modules/admin/admin-vnext-style.js')]);
  expect(vnext).toContain("d.className='cx-adminv-runtime'");
  expect(vnext).toContain('Runtime diagnostics');
  expect(style).toContain('var(--color-bg-surface)');
  expect(style).toContain('var(--color-border)');
  expect(style).toContain('var(--color-accent)');
  expect(style).not.toMatch(/background:\s*#[0-9a-f]{3,8}/i);
});
