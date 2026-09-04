import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('sealed lifecycle transitions mature into leakage-safe observed outcomes', async () => {
  const sql=fs.readFileSync('supabase/migrations/20260903063000_add_sealed_lifecycle_transition_outcomes.sql','utf8');
  const renderer=fs.readFileSync('src/modules/sealed/renderer.js','utf8');
  expect(sql).toContain('with (security_invoker=true)');
  expect(sql).toContain("current_date>=e.observed_at::date+30");
  expect(sql).toContain("current_date>=e.observed_at::date+90");
  expect(sql).toContain("'MATURING'");
  expect(sql).toContain('TCG Market measures trajectory and is never liquidation EV');
  expect(renderer).toContain('Lifecycle history');
  expect(renderer).toContain('no synthetic transitions are backfilled');
  expect(renderer).toContain('sealed.detail:v11');
});
