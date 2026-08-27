import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Scout Signals confidence is priority context, not grade mutation',async()=>{
  const source=await read('src/modules/signals/scout-badges.js');
  expect(source).toContain('market_intel_scout_confidence?select=');
  expect(source).toContain('priority context · grade unchanged');
  expect(source).toContain('independent source');
  expect(source).toContain('Oracle-family link');
});

test('Signal confidence SQL requires independent corroboration for stronger labels',async()=>{
  const sql=await read('cloud-worker/scout-signal-confidence.sql');
  expect(sql).toContain("independent_sources>=3 and raw_priority_boost>=6");
  expect(sql).toContain("independent_sources>=2 and raw_priority_boost>=4");
  expect(sql).toContain("when weighted_net<=0 then 'mixed_or_bearish'");
  expect(sql).toContain('does NOT change Scout grade/economics');
});
