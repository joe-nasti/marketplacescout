import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Scout keeps first-paint guard and canonical structure style before the route-owned renderer',async()=>{
  const source=await read('src/modules/scout/index.js');
  const guard=source.indexOf("import('./first-paint-guard.js')");
  const structure=source.indexOf("import('./structure-style.js')");
  const renderer=source.indexOf("import('./renderer.js')");
  expect(guard).toBeGreaterThan(-1);
  expect(structure).toBeGreaterThan(guard);
  expect(renderer).toBeGreaterThan(structure);
  expect(source).not.toContain("import('./ia-v2-style.js')");
  expect(source).not.toContain("import('./compact-mobile.js')");
  expect(source).not.toContain("import('./dense-list.js')");
  expect(source).not.toContain("import('./ia-v2.js')");
});

test('Scout renderer owns filters without a second mobile controller',async()=>{
  const renderer=await read('src/modules/scout/renderer.js');
  expect(renderer).toContain('cxScoutFilterSheet');
  expect(renderer).toContain('cxLiquidityFilter');
  expect(renderer).toContain('function rowMatches(r)');
  expect(renderer).toContain('function applyFilters()');
  expect(renderer).not.toContain('dataset.cxAdvancedMatch');
});

test('Scout renderer emits dense rows directly before enhancer decoration',async()=>{
  const renderer=await read('src/modules/scout/renderer.js');
  expect(renderer).toContain('cx-scout-dense-row');
  expect(renderer).toContain('cx-scout-dense-list');
  expect(renderer).toContain('cx-scout-mobile-metrics');
  expect(renderer).not.toContain('requestAnimationFrame(()=>requestAnimationFrame(decorate))');
});

test('Scout mobile first paint waits for route-owned IA and dense list',async()=>{
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
