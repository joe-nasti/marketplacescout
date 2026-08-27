import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Scout Signals flow through unified opportunity context without grade mutation',async()=>{
  const source=await read('src/modules/signals/scout-badges.js');
  expect(source).toContain('scout_opportunity_context?select=');
  expect(source).toContain("context.get(String(row?.sku_id||''))");
  expect(source).toContain('priority/urgency only · grade unchanged');
  expect(source).toContain('signal_independent_sources');
  expect(source).toContain("return'Oracle family'");
  expect(source).toContain("return'related printing'");
});

test('Signal confidence SQL requires independent corroboration for stronger labels',async()=>{
  const sql=await read('cloud-worker/scout-signal-confidence.sql');
  expect(sql).toContain("independent_sources>=3 and raw_priority_boost>=6");
  expect(sql).toContain("independent_sources>=2 and raw_priority_boost>=4");
  expect(sql).toContain("when weighted_net<=0 then 'mixed_or_bearish'");
  expect(sql).toContain('does NOT change Scout grade/economics');
});
