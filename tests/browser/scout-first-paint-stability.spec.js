import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Scout keeps first-paint guard before renderer and final IA on primary path',async()=>{
  const source=await read('src/modules/scout/index.js');
  const guard=source.indexOf("import('./first-paint-guard.js')");
  const renderer=source.indexOf("import('./renderer.js')");
  expect(guard).toBeGreaterThan(-1);
  expect(renderer).toBeGreaterThan(guard);
  for(const mod of ["import('./ia-v2-style.js')","import('./compact-mobile.js')","import('./dense-list.js')","import('./ia-v2.js')"]){
    expect(source).toContain(mod);
  }
});

test('Scout compact mobile controller filters in place and never replaces list DOM',async()=>{
  const compact=await read('src/modules/scout/compact-mobile.js');
  expect(compact).toContain('dataset.cxAdvancedMatch');
  expect(compact).not.toContain('host.innerHTML=rows.map');
  expect(compact).not.toContain('cx-scout-compact-card');
});

test('Scout dense list decorates before paint instead of two animation frames later',async()=>{
  const dense=await read('src/modules/scout/dense-list.js');
  expect(dense).toContain('queueMicrotask(decorate)');
  expect(dense).not.toContain('requestAnimationFrame(()=>requestAnimationFrame(decorate))');
});

test('Scout mobile first paint waits for IA and dense-list ownership',async()=>{
  const source=await read('src/modules/scout/first-paint-guard.js');
  expect(source).toContain("host.classList.add('cx-scout-preparing')");
  expect(source).toContain('#cxParityCards.cx-scout-dense-list');
  expect(source).toContain("host.classList.remove('cx-scout-preparing')");
});

test('mobile utilities are normal-flow and advanced filters never alter row geometry',async()=>{
  const theme=await read('src/core/theme.js');
  const css=await read('src/styles/mobile-quality.css');
  expect(theme).toContain("bar.id='cxTopUtilities'");
  expect(theme).toContain('app.prepend(bar)');
  expect(css).toContain('#app>.cx-top-utilities');
  expect(css).toContain('position:static!important');
  expect(css).toContain('[data-cx-advanced-match="0"]{display:none!important}');
  expect(css).toContain('#cxParityCards.cx-scout-dense-list{overflow-x:hidden}');
});
