import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();const read=p=>readFile(path.join(root,p),'utf8');

test('Admin Singles owns detailed scan health',async()=>{
  const source=await read('src/modules/admin/console.js');
  expect(source).toContain("const mh=admin?.querySelector('.cx-marketplace-health')");
  expect(source).toContain("singles.insertBefore(mh,singles.firstChild)");
  expect(source).not.toContain("overview.appendChild(mh)");
});

test('Admin Sealed health/catalog state is owned by console and survives refreshes',async()=>{
  const source=await read('src/modules/admin/console.js');
  expect(source).toContain("let active='overview',loading=false,sealedView='health'");
  expect(source).toContain('data-admin-sealed-view="health"');
  expect(source).toContain('data-admin-sealed-view="catalog"');
  expect(source).toContain("sources.hidden=sealedView!=='health'");
  expect(source).toContain("catalog.hidden=sealedView!=='catalog'");
  expect(source).toContain('adoptLooseChildren(shell);applySealedView();');
});

test('Admin runtime diagnostics has one permanent disclosure owner',async()=>{
  const source=await read('src/modules/admin/console.js');
  expect(source).toContain("let d=system.querySelector('.cx-admin-runtime-disclosure')");
  expect(source).toContain("if(runtime.parentElement!==body)body.appendChild(runtime)");
  expect(source).toContain('Performance, transport, retries, and Supabase endpoint cost');
});
