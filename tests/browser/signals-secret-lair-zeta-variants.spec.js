import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');

test('Zeta Signals uses exact treatment printings and conservative value floor', async()=>{
  const ui=read('src/modules/signals/secret-lair-zeta.js');
  expect(ui).toContain('secret_lair_randomized_card_printings');
  expect(ui).toContain('secret_lair_randomized_oracle_floors');
  expect(ui).toContain('exact treatment printings');
  expect(ui).toContain('Oracle-floor mean baseline');
  expect(ui).toContain('Actual treatment premiums remain zero');
  expect(ui).toContain('1–121 Photocopy');
  expect(ui).toContain('122–242 Photocopy Negative');
  expect(ui).toContain('243–363 Color Banding');
});

test('Zeta printing migration preserves 363 exact identities with no inferred print run', async()=>{
  const sql=read('supabase/migrations/20260902040600_secret_lair_zeta_exact_printings_and_oracle_floors.sql');
  expect(sql).toContain('secret_lair_randomized_card_printings');
  expect(sql).toContain("between 1 and 121");
  expect(sql).toContain("between 122 and 242");
  expect(sql).toContain("color_banding");
  expect(sql).toContain("set_code='SLZ'");
  expect(sql).toContain('security_invoker=true');
  expect(sql).not.toMatch(/print_run\s*=\s*[0-9]/i);
});
