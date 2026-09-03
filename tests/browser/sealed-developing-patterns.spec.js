import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('sealed patterns persist real transitions without a new crawl', async () => {
  const sql=fs.readFileSync('supabase/migrations/20260903060000_record_sealed_lifecycle_transitions.sql','utf8');
  const archive=fs.readFileSync('cloud-worker/archive-sealed-price-current.mjs','utf8');
  const renderer=fs.readFileSync('src/modules/sealed/renderer.js','utf8');
  expect(sql).toContain('st.current_state<>s.lifecycle_state');
  expect(sql).toContain('select public.snapshot_sealed_product_lifecycle_states()');
  expect(sql).toContain("Observational ranking only until walk-forward calibration earns HIGH confidence");
  expect(sql).toContain('(select auth.uid())=user_id');
  expect(sql).toContain('security invoker');
  const policy=fs.readFileSync('supabase/migrations/20260903060500_exclude_anonymous_sealed_lifecycle_reads.sql','utf8');
  expect(policy).toContain("auth.jwt()->>'is_anonymous'");
  expect(archive).toContain('rpc/snapshot_sealed_product_lifecycle_states');
  expect(renderer).toContain('Developing patterns');
  expect(renderer).toContain('data-sealed-view="patterns"');
});
