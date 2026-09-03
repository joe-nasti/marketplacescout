import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('sealed supply squeeze requires historical compression and sales', async () => {
  const sql=fs.readFileSync('supabase/migrations/20260903053000_use_historical_supply_in_sealed_lifecycle.sql','utf8');
  const renderer=fs.readFileSync('src/modules/sealed/renderer.js','utf8');
  expect(sql).toContain('sealed_product_price_history');
  expect(sql).toContain('supply_compression_7d_pct>=20');
  expect(sql).toContain('supply_compression_30d_pct>=35');
  expect(sql).toContain("supply_trend_confidence<>'LOW'");
  expect(sql).toContain('units_30d>=5');
  expect(sql.match(/security_invoker=true/g)?.length).toBe(2);
  expect(renderer).toContain('Listing compression');
  expect(renderer).toContain('Supply squeeze requires declining listings plus demonstrated sales');
});
