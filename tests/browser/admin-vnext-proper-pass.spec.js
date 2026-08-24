import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();const read=p=>readFile(path.join(root,p),'utf8');

test('Admin has one presentation owner',async()=>{
  const index=await read('src/modules/admin/index.js'),consoleSource=await read('src/modules/admin/console.js');
  expect(index).toContain("import('./console.js')");
  expect(index).toContain("import('./single-owner-style.js')");
  expect(index).not.toContain('proper-pass');expect(index).not.toContain('ia-followup');
  expect(consoleSource).toContain('function applySection');
  expect(consoleSource).toContain('if(changed&&emit)document.dispatchEvent');
  expect(consoleSource).not.toContain('document.dispatchEvent(new CustomEvent(\'collectish:admin-section-change\',{detail:{section:active}}));\n    if(refresh)');
});

test('Admin Sealed refresh updates a dedicated base slot instead of destroying child health modules',async()=>{
  const source=await read('src/modules/admin/console.js');
  expect(source).toContain('id="cxAdminSealedBaseSources"');
  expect(source).toContain("shell.querySelector('#cxAdminSealedBaseSources')");
  expect(source).not.toContain("shell.querySelector('#cxAdminSealedSources').innerHTML");
});

test('Admin single-owner styling stays theme-token driven',async()=>{
  const source=await read('src/modules/admin/single-owner-style.js');
  expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(source).toContain('var(--color-bg-surface)');
  expect(source).toContain('var(--color-text-secondary)');
  expect(source).toContain('var(--color-accent)');
});
