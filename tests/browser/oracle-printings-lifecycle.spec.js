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

test('Oracle bulk refresh is one-off, bounded, and asks before large batches',async()=>{
  const source=await read('src/modules/scout/oracle-bulk-refresh.js');
  expect(source).toContain('AUTO_CONFIRM_LIMIT=8');
  expect(source).toContain('BATCH_LIMIT=25');
  expect(source).toContain('window.confirm');
  expect(source).toContain("p_reason:'oracle_compare_bulk'");
  expect(source).toContain("rpc/request_scout_refresh");
  expect(source).toContain('Stale + catalog-only');
  expect(source).toContain('Dormant only');
  expect(source).toContain('Catalog-only');
  expect(source).not.toContain('recurring');
});

test('Oracle printing detail preserves family navigation and explains winning badges',async()=>{
  const source=await read('src/modules/scout/oracle-detail-context.js');
  expect(source).toContain('Back to ${familyName()} printings');
  expect(source).toContain('Why this printing wins');
  expect(source).toContain('Why this printing currently leads');
  expect(source).toContain('Next best:');
  expect(source).toContain('BEST SCOUT');
  expect(source).toContain('BEST BUY');
  expect(source).toContain('BEST DIRECT ROI');
  expect(source).toContain('MOST LIQUID');
  expect(source).toContain('oracleOpenSku');
  expect(source).toContain('backToFamily');
  expect(source).toContain('collectish:oracle-family-confidence');
});

test('Oracle family confidence weights current, dormant, and catalog coverage explicitly',async()=>{
  const source=await read('src/modules/scout/oracle-family-confidence.js');
  expect(source).toContain('(c.dormant*.5)');
  expect(source).toContain("score>=80?'High':score>=50?'Medium':'Low'");
  expect(source).toContain('Current printings count fully');
  expect(source).toContain('dormant printings receive half credit');
  expect(source).toContain('catalog-only printings receive no credit');
  expect(source).toContain('Family confidence');
  expect(source).toContain('collectish:oracle-family-confidence');
  expect(source).toContain('CURRENT LEADER');
  expect(source).toContain('CONFIDENCE');
});
