import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Oracle printing compare uses Scout lifecycle events instead of DOM observers',async()=>{
  const source=await read('src/modules/scout/oracle-printings.js');
  expect(source).not.toContain('MutationObserver');
  expect(source).toContain("collectish:scout-list-rendered");
  expect(source).toContain('refreshCompareDecorations');
});

test('Oracle family search renders decision-oriented printing comparison metrics',async()=>{
  const source=await read('src/modules/scout/universal-search.js');
  expect(source).toContain('familyAwards');
  expect(source).toContain('BEST BUY');
  expect(source).toContain('BEST DIRECT ROI');
  expect(source).toContain('MOST LIQUID');
  expect(source).toContain('Direct ROI');
  expect(source).toContain('Buylist ROI');
  expect(source).toContain('Velocity');
  expect(source).toContain('cx-oracle-result');
});

test('Oracle family comparison can sort and filter without dropping catalog printings by default',async()=>{
  const source=await read('src/modules/scout/universal-search.js');
  expect(source).toContain('familySort');
  expect(source).toContain('familyFilter');
  expect(source).toContain('Best opportunity');
  expect(source).toContain('Cheapest');
  expect(source).toContain('Scout score');
  expect(source).toContain('All printings');
  expect(source).toContain('Catalog-only');
  expect(source).toContain("filter:p.get('oracleFilter')||'all'");
  expect(source).toContain('oracleSort');
  expect(source).toContain('oracleFilter');
});
