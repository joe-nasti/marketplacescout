import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('sealed trajectory calibration is leakage-safe and visible', async () => {
  const sql=fs.readFileSync('supabase/migrations/20260903043000_add_sealed_trajectory_backtests.sql','utf8');
  const renderer=fs.readFileSync('src/modules/sealed/renderer.js','utf8');
  const workflow=fs.readFileSync('.github/workflows/tcgcsv-sealed-history-backfill.yml','utf8');
  expect(sql).toContain('a.outcome_date<=t.checkpoint_date');
  expect(sql).toContain('actual_future_90d_return_pct');
  expect(sql).toContain('direction_accuracy_pct');
  expect(sql.match(/security_invoker=true/g)?.length).toBe(3);
  expect(renderer).toContain('Walk-forward calibration');
  expect(renderer).toContain('trajectory evidence—not liquidation EV');
  expect(workflow).toContain('cron: "15 * * * *"');
  expect(workflow).toContain("inputs.max_archives || '12'");
});
