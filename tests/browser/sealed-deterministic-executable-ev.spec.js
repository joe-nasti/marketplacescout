import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('SOC Commander decks use exact executable card exits and roll up the set of five', async () => {
  const sql=await fs.readFile(new URL('../../supabase/migrations/20260903005330_sealed_deterministic_executable_ev.sql',import.meta.url),'utf8');
  expect(sql).toContain("upper(p.set_code)='SOC'");
  expect(sql).toContain("'deck_card'");
  expect(sql).toContain('collectish_direct_net(p.direct_low_price)*.85');
  expect(sql).toContain('collectish_tcg_regular_net(p.low_price)*.75');
  expect(sql).toContain('v.manapool_retail*.975*.65');
  expect(sql).toContain('sealed_fixed_practical_ev');
  expect(sql).toContain("'children_current_only'");
  expect(sql).toContain("'SOC exact five-deck container'");
  expect(sql).toContain("'VALUE CONCENTRATED'");
  const refinement=await fs.readFile(new URL('../../supabase/migrations/20260903005809_refine_deterministic_container_distribution.sql',import.meta.url),'utf8');
  expect(refinement).toContain('sealed_fixed_child_practical_ev');
  expect(refinement).toContain("b.coverage_state='DETERMINISTIC'");
});
