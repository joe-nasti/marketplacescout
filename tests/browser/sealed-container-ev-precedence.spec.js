import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const migration='supabase/migrations/20260903190000_prevent_modeled_sealed_container_double_count.sql';

test('direct box and case collation takes precedence over equivalent child packs',async()=>{
  const sql=await readFile(migration,'utf8');
  for(const value of ['tcg_low_ev','direct_first_net_ev','collectish_live_out_ev']){
    expect(sql).toContain(`when b.model_key is not null then b.${value}`);
  }
  expect(sql).toContain("when b.model_key is not null then b.valuation_basis");
  expect(sql).toContain("when b.model_key is not null then 0 else coalesce(ch.modeled_child_units,0) end modeled_child_units");
});

test('unmodeled fixed-content containers still add their child products',async()=>{
  const sql=await readFile(migration,'utf8');
  expect(sql).toContain("coalesce(b.tcg_low_ev,0)+coalesce(ch.child_tcg_low_ev,0)");
  expect(sql).toContain("then 'children_plus_fixed_current_only'");
  expect(sql).toContain("then 'children_current_only'");
});
