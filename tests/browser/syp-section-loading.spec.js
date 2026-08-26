import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('SYP establishes the route shell before metadata reads complete',async()=>{
  const source=await read('src/modules/seller/syp-feed.js');
  const start=source.indexOf('async function load(force=false)');
  const end=source.indexOf('\n  function install()',start);
  const load=source.slice(start,end);
  expect(load).toContain('shell(pageHost);renderBody();');
  expect(load).toContain("collectish:syp-shell-rendered");
  expect(load).toContain('Promise.allSettled([');
  expect(load.indexOf('shell(pageHost);renderBody();')).toBeLessThan(load.indexOf('Promise.allSettled(['));
  expect(load).not.toContain("pageHost.innerHTML='<div class=\"cx-page-head\"");
});

test('SYP metadata updates owned KPI and filter sections without rebuilding the route',async()=>{
  const source=await read('src/modules/seller/syp-feed.js');
  expect(source).toContain('function renderStats()');
  expect(source).toContain('function refreshFilterOptions()');
  expect(source).toContain("id=\"cxSypKpiProducts\"");
  expect(source).toContain("metadataStatus:errors.length?'degraded':'ready'");
  expect(source).toContain("pageHost.dataset.sypParity='ready'");
});

test('SYP default product rows remain independently loaded',async()=>{
  const source=await read('src/modules/seller/syp-feed.js');
  expect(source).toContain('function renderBody()');
  expect(source).toContain('void loadPage()');
  expect(source).toContain("table.innerHTML='<div class=\"cx-empty\">Loading…</div>'");
  expect(source).toContain("collectish:syp-page-rendered");
});
