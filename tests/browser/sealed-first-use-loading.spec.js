import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Sealed opportunity rows own first useful paint while set-type metadata is useful-soon',async()=>{
  const renderer=await read('src/modules/sealed/renderer.js');
  const contracts=await read('src/state/route-data-contracts.js');
  const loadIndex=renderer.slice(renderer.indexOf('async function loadIndex'),renderer.indexOf('function filteredRows'));
  expect(loadIndex).toContain("loadResource('sealed.rows'");
  expect(loadIndex).not.toContain('Promise.all');
  expect(loadIndex).toContain('void loadSetTypes(force)');
  expect(contracts).toContain("{key:'sealed.rows',role:'firstUse'");
  expect(contracts).toContain("{key:'sealed.setTypes',role:'usefulSoon'");
});

test('late Sealed set metadata updates owned surfaces without rebuilding the route shell',async()=>{
  const renderer=await read('src/modules/sealed/renderer.js');
  const setTypes=renderer.slice(renderer.indexOf('async function loadSetTypes'),renderer.indexOf('async function loadIndex'));
  expect(setTypes).toContain('refreshSetTypeSurface()');
  expect(setTypes).toContain("collectish:sealed-set-types-ready");
  expect(setTypes).not.toContain('renderShell()');
  expect(renderer).toContain("collectish:sealed-core-ready");
});

test('Sealed detail remains interaction-driven and keeps its local skeleton',async()=>{
  const renderer=await read('src/modules/sealed/renderer.js');
  expect(renderer).toContain('cx-sealed-detail-skeleton');
  expect(renderer).toContain('loadDetailData(r)');
  expect(renderer).toContain("sealed.detail:${r.sealed_uuid}");
});
