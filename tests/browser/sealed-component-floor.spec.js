import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('component-only Commander products expose a floor without a grade or recommendation', async () => {
  const sql=await fs.readFile(new URL('../../supabase/migrations/20260903013125_expose_commander_component_floor.sql',import.meta.url),'utf8');
  expect(sql).toContain("in ('partial','component_only','unmodeled')");
  expect(sql).toContain('then ownfp.practical_liquidation_ev');
  expect(sql).toContain('when not b.recommendation_eligible then null');
  expect(sql).toContain('when not c.recommendation_eligible then null');
  expect(sql).toContain("when not s.recommendation_eligible then null");
  expect(sql).toContain("then 'MODEL PENDING'");
  expect(sql).toContain('with (security_invoker=true)');
});
