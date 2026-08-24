import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Scout final mobile presentation loads in the primary renderer path',async()=>{
  const source=await read('src/modules/scout/index.js');
  expect(source).toContain("import('./first-paint-guard.js')");
  expect(source).toContain("import('./ia-v2.js')");
  expect(source).toContain("import('./compact-mobile.js')");
  expect(source).toContain("import('./dense-list.js')");
  expect(source).toContain('Promise.all');
});

test('Scout mobile first paint waits for IA and dense-list ownership',async()=>{
  const source=await read('src/modules/scout/first-paint-guard.js');
  expect(source).toContain("host.classList.add('cx-scout-preparing')");
  expect(source).toContain("#cxParityCards.cx-scout-dense-list");
  expect(source).toContain("host.classList.remove('cx-scout-preparing')");
  expect(source).toContain('requestAnimationFrame(waitForFinal)');
});

test('mobile utilities live in a normal-flow top strip and Scout hides intermediate geometry',async()=>{
  const theme=await read('src/core/theme.js');
  const css=await read('src/styles/mobile-quality.css');
  expect(theme).toContain("bar.id='cxTopUtilities'");
  expect(theme).toContain('app.prepend(bar)');
  expect(theme).toContain('bar.appendChild(badge)');
  expect(theme).toContain('bar.appendChild(button)');
  expect(css).toContain('#app>.cx-top-utilities');
  expect(css).toContain('position:static!important');
  expect(css).toContain('#cxScout.cx-scout-preparing .cx-scout-toolbar');
  expect(css).toContain('#cxScout.cx-scout-preparing .cx-scout-layout');
  expect(css).toContain('#cxParityCards.cx-scout-dense-list{overflow-x:hidden}');
});
