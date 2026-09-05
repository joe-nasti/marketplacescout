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
  const [source,renderer]=await Promise.all([
    read('src/modules/scout/first-paint-guard.js'),
    read('src/modules/scout/renderer.js')
  ]);
  expect(source).toContain("host.classList.add('cx-scout-preparing')");
  expect(source).toContain('mobile&&usefulContentAtInstall');
  expect(source).toContain('#cxParityCards.cx-scout-dense-list');
  expect(source).toContain("host.classList.remove('cx-scout-preparing')");
  expect(renderer).toContain("function releasePreparing(h){h?.classList.remove('cx-scout-preparing')}");
  expect(renderer.indexOf('function skeleton(h){releasePreparing(h)')).toBeGreaterThan(-1);
});

test('mobile utility shelf stays outside Scout row geometry and snaps back to content origin',async()=>{
  const [shell,theme,origin,utilityCss,css]=await Promise.all([
    read('src/core/shell.js'),
    read('src/core/theme.js'),
    read('src/core/mobile-utility-origin.js'),
    read('src/styles/utility-controls.css'),
    read('src/styles/mobile-quality.css')
  ]);
  expect(shell).toContain('id="cxMobileUtilities"');
  expect(shell).toContain('id="cxDesktopUtilities"');
  expect(theme).toContain("document.getElementById('cxMobileUtilities')");
  expect(theme).toContain("document.getElementById('cxDesktopUtilities')");
  expect(origin).toContain("document.getElementById('cxMobileUtilities')");
  expect(origin).toContain('scheduleShelfSnap');
  expect(origin).toContain("behavior:'smooth'");
  expect(utilityCss).toContain('.cx-mobile-utilities');
  expect(utilityCss).toContain('.cx-desktop-utilities');
  expect(css).toContain('[data-cx-advanced-match="0"]{display:none!important}');
  expect(css).toContain('#cxParityCards.cx-scout-dense-list{overflow-x:hidden}');
});
