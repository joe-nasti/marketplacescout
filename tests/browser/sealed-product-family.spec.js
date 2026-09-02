import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Sealed product-family surface is adapter-backed and set-aware', async()=>{
  const index=await read('src/modules/sealed/index.js');
  const family=await read('src/modules/sealed/product-family.js');
  expect(index).toContain("import('./product-family.js')");
  expect(family).toContain('sealed_product_model_coverage?');
  expect(family).toContain('Modeled sealed families');
  expect(family).toContain('coverage_state');
  expect(family).toContain('recommendation_eligible');
  expect(family).toContain('cxSealedFamilySet');
  expect(family).toContain('Gross crack EV');
  expect(family).toContain('Net / realizable');
  expect(family).not.toContain('&set_code=eq.HOB');
});

test('coverage gate blocks incomplete sealed recommendations', async()=>{
  const family=await read('src/modules/sealed/product-family.js');
  for(const state of ['COLLATION PARTIAL','COMPONENT FLOOR','UNMODELED'])expect(family).toContain(state);
  expect(family).toContain('recommendation_eligible');
  expect(family).toContain('MODEL PENDING');
  expect(family).toContain('BUY & CRACK');
  expect(family).toContain('GROSS EV ONLY');
});

test('generic collation registry preserves Hobbit as first data profile', async()=>{
  const migration=await read('supabase/migrations/20260902184500_sealed_collation_adapter_registry.sql');
  expect(migration).toContain('sealed_collation_adapters');
  expect(migration).toContain('sealed_collation_profile_bindings');
  expect(migration).toContain('sealed_collation_binding_resolved');
  expect(migration).toContain('sealed_product_model_coverage');
  for(const adapter of ['modern_play_booster_official_v1','modern_collector_booster_official_v1','sealed_composite_children_v1','sealed_deterministic_cards_v1','sealed_container_rollup_v1'])expect(migration).toContain(adapter);
  expect(migration).toContain("'HOB'");
  expect(migration).toContain("'partial'");
  expect(migration).toContain("'deterministic'");
});

test('mixed sealed products expose derived Singles and landed-cost decisions', async()=>{
  const index=await read('src/modules/sealed/index.js');
  const compare=await read('src/modules/sealed/source-compare.js');
  expect(index).toContain("import('./source-compare.js')");
  expect(compare).toContain('sealed_single_source_compare_current?');
  expect(compare).toContain('Buy direct');
  expect(compare).toContain('Crack sealed');
  expect(compare).toContain('Best exit');
  expect(compare).toContain('Crack advantage');
  expect(compare).toContain('Open in Scout');
  expect(compare).toContain('Fixed-card Out Optimization');
  expect(compare).toContain('Mixed sealed product:');
  expect(compare).toContain('card_set_code');
  expect(compare).toContain('Your landed acquisition cost');
  expect(compare).toContain('applyScenario');
  expect(compare).toContain('recommendation');
  for (const label of ['BUY & CRACK','FLIP SEALED','MARGINAL CRACK','KEEP SEALED','GROSS EV ONLY','PASS']) expect(compare).toContain(label);
});

test('Scout Singles compares buy direct, sealed sourcing and live outlet exit from fast cache', async()=>{
  const index=await read('src/modules/scout/index.js');
  const compare=await read('src/modules/scout/sealed-source-compare.js');
  expect(index).toContain("import('./sealed-source-compare.js')");
  expect(compare).toContain('Buy direct · Crack sealed · Best exit');
  expect(compare).toContain('sealed_single_source_compare_current?');
  expect(compare).toContain('ev_allocated_acquisition_per_copy');
  expect(compare).toContain('card_set_code=eq.');
  expect(compare).toContain("['TCG Direct',Number(row?.direct_net_est)]");
  expect(compare).toContain("['Card Kingdom',Number(row?.ck_buylist)]");
  expect(compare).toContain("['ManaPool',Number(row?.manapool_retail||0)*0.921]");
  expect(compare).toContain('Best live exit');
  expect(compare).not.toContain("rest('rpc/sealed_single_source_compare'");
});

test('Play Booster backtest preserves rounded-probability caveat', async()=>{
  const migrations=await read('supabase/migrations/20260902145500_hobbit_play_booster_backtest_runner.sql');
  expect(migrations).toContain('run_hobbit_play_backtest');
  expect(migrations).toContain('rounded <1% residual');
  expect(migrations).toContain('eligible pool size');
});

test('Collector Booster pack has a standalone distribution runner', async()=>{
  const migration=await read('supabase/migrations/20260902151500_hobbit_collector_pack_backtest_runner.sql');
  expect(migration).toContain('run_hobbit_collector_pack_backtest');
  expect(migration).toContain('Single Hobbit Collector Booster Monte Carlo');
  expect(migration).toContain('no box topper');
});
