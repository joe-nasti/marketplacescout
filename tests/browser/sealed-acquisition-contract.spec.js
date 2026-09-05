import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('internal sealed routes require TCG Low plus shipping',async()=>{
  const migration=await readFile('supabase/migrations/20260905213317_require_landed_sealed_child_exit_prices.sql','utf8');
  expect(migration).toContain('with (security_invoker=true)');
  expect(migration).toContain('sp.low_with_shipping::numeric sealed_tcg_low');
  expect(migration).toContain('and sp.low_with_shipping>0');
  expect(migration).toContain("v_safe text := 'select p.low_with_shipping,p.captured_at'");
  expect(migration).toContain('landed TCG Low + shipping');
  expect(migration).not.toMatch(/coalesce\s*\(\s*sp\.low_with_shipping\s*,\s*sp\.low_price/i);
  expect(migration).not.toMatch(/v_safe[^;]*market_price/i);
});
