import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const scoutPath=name=>path.join(process.cwd(),'src/modules/scout',name);

test('Scout preserves first useful paint while renderer refreshes',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const [index,guard]=await Promise.all([
    readFile(scoutPath('index.js'),'utf8'),
    readFile(scoutPath('first-paint-guard.js'),'utf8')
  ]);
  expect(index.indexOf("import('./first-paint-guard.js')")).toBeLessThan(index.indexOf("import('./renderer.js')"));
  expect(guard).toContain("const preserved=[...host.childNodes]");
  expect(guard).toContain("text.includes('Loading Scout v5')");
  expect(guard).toContain('host.replaceChildren(...preserved)');
  expect(guard).toContain("document.addEventListener('collectish:scout-v5-ready',release,{once:true})");
});

test('Scout card opening is centralized across ranked and quick-turn surfaces',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const [index,navigation]=await Promise.all([
    readFile(scoutPath('index.js'),'utf8'),
    readFile(scoutPath('detail-navigation.js'),'utf8')
  ]);
  expect(index.indexOf("import('./detail-navigation.js')")).toBeGreaterThan(index.indexOf("import('./renderer.js')"));
  expect(navigation).toContain("#cxScout .cx-scout-card[data-sku], #cxScout [data-quick-turn-sku]");
  expect(navigation).toContain("document.addEventListener('collectish:open-scout-card',openEvent)");
  expect(navigation).toContain("store.update('scout',{selectedSku:summary.sku_id})");
  expect(navigation).toContain('void renderer.renderDetail(summary,true)');
  expect(navigation).toContain('e.stopImmediatePropagation()');
});
