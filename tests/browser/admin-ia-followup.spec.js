import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Admin follow-up moves detailed scan health to Singles',async()=>{
  const source=await read('src/modules/admin/ia-followup.js');
  expect(source).toContain("const singles=panel('singles')");
  expect(source).toContain("summary.insertAdjacentElement('afterend',mh)");
  expect(source).toContain("disclosure.remove()");
  expect(source).toContain("collectish:runtime-health");
});

test('Admin Sealed separates health from catalog management',async()=>{
  const source=await read('src/modules/admin/ia-followup.js');
  expect(source).toContain('data-admin-sealed-view="health"');
  expect(source).toContain('data-admin-sealed-view="catalog"');
  expect(source).toContain("sources.hidden=sealedView!=='health'");
  expect(source).toContain("catalog.hidden=sealedView!=='catalog'");
  expect(source).toContain("sealedView='health'");
});

test('Admin Runtime diagnostics reuses one disclosure after relocations',async()=>{
  const source=await read('src/modules/admin/ia-followup.js');
  expect(source).toContain("system.querySelectorAll('.cx-admin-runtime-disclosure')");
  expect(source).toContain("extras.slice(1).forEach(x=>x.remove())");
  expect(source).toContain("if(runtime.parentElement!==body)body.appendChild(runtime)");
  expect(source).toContain('Performance, transport, retries, and Supabase endpoint cost');
});

test('Admin IA follow-up is theme-token driven',async()=>{
  const source=await read('src/modules/admin/ia-followup.js');
  expect(source).toContain('var(--color-bg-surface)');
  expect(source).toContain('var(--color-text-secondary)');
  expect(source).toContain('var(--color-accent)');
  expect(source).not.toMatch(/background:\s*#[0-9a-f]{3,8}/i);
});
