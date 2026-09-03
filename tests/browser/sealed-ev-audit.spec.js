import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const migration='supabase/migrations/20260903014346_add_sealed_ev_audit_sensitivity.sql';

test('sealed EV uses native sheet weights and auditable executable modes',async()=>{
  const sql=await readFile(migration,'utf8');
  expect(sql).toContain("metadata->>'native_weight'");
  expect(sql).toContain('sum(v.tcg_low*v.native_weight)');
  expect(sql).toContain('cash_floor_ev');
  expect(sql).toContain('optimistic_ev');
  expect(sql).toContain('market_price_used\',false');
  expect(sql).toContain('syp_or_last_known_direct_used\',false');
  expect(sql).toContain('marketplace_fee_deduction');
  expect(sql).toContain('liquidity_labor_deduction');
  expect(sql).toContain('not exists (\n      select 1 from latest modeled_ancestor');
});

test('Scout Sealed exposes EV sensitivity and audit evidence',async()=>{
  const ui=await readFile('src/modules/sealed/renderer.js','utf8');
  for(const label of ['EV sensitivity','Cash floor','Practical EV','Optimistic EV','EV audit','TCG priced coverage','Excluded at $0','Marketplace fees','Liquidity + labor','Stale route units'])expect(ui).toContain(label);
  expect(ui).toContain('TCG Market, SYP, and last-known Direct prices are excluded');
  expect(ui).toContain('ev_audit');
});
