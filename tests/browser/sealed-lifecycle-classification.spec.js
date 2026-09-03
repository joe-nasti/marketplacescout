import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('collector-box lifecycle signals remain evidence-backed and gated', async () => {
  const sql=fs.readFileSync('supabase/migrations/20260903050000_add_sealed_lifecycle_classification.sql','utf8');
  const renderer=fs.readFileSync('src/modules/sealed/renderer.js','utf8');
  for(const state of ['ACCUMULATION','BREAKOUT','SUPPLY SQUEEZE','PLATEAU','REVERSAL']) expect(sql).toContain(`'${state}'`);
  expect(sql).toContain("when calibration_confidence<>'HIGH' then 'OBSERVE'");
  expect(sql).toContain("units_30d>=5");
  expect(sql).toContain("total_listings between 1 and 20");
  expect(sql).toContain('security_invoker=true');
  expect(renderer).toContain('Collector-box lifecycle');
  expect(renderer).toContain('TCG Market is never used as liquidation EV');
});
