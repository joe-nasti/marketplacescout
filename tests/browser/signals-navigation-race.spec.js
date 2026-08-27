import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const source=p=>readFile(path.join(root,p),'utf8');

test('Signals cannot be bounced to Scout by a generic open-card event',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const [modules,guard,bridge]=await Promise.all([
    source('src/modules/index.js'),
    source('src/modules/signals/scout-open-navigation-guard.js'),
    source('src/modules/signals/scout-intelligence-bridge.js')
  ]);
  expect(modules.indexOf("import('./signals/scout-open-navigation-guard.js')")).toBeLessThan(modules.indexOf("import('./signals/scout-intelligence-bridge.js')"));
  expect(guard).toContain("if(page==='scout'||event.detail?.navigateToScout===true)return");
  expect(guard).toContain('event.stopImmediatePropagation()');
  expect(bridge).toContain("document.addEventListener('collectish:open-scout-card',e=>openScout(e.detail||{}))");
});

test('intentional Signals Scan and Discovery row clicks retain explicit Scout navigation',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const guard=await source('src/modules/signals/scout-open-navigation-guard.js');
  expect(guard).toContain("event.target.closest?.('#cxSignals [data-sv-open], #cxSignals [data-discovery-open]')");
  expect(guard).toContain('navigateToScout:true');
  expect(guard).toContain("row.hasAttribute('data-discovery-open')?'signals-discovery':'signals'");
  expect(guard).toContain("window.CollectishShell?.switchPage?.('scout')");
  expect(guard).toContain("queueMicrotask(()=>document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail})))");
});
