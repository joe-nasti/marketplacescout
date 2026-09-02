import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Sealed mounts the MTGJSON product-family economics pilot', async()=>{
  const index=await read('src/modules/sealed/index.js');
  const family=await read('src/modules/sealed/product-family.js');
  expect(index).toContain("import('./product-family.js')");
  expect(family).toContain('sealed_product_family_economics?');
  expect(family).toContain('The Hobbit · sealed product family');
  expect(family).toContain('Gross crack EV');
  expect(family).toContain('Net / realizable');
  expect(family).toContain('deterministic_deck_components');
  expect(family).toContain('BUY & CRACK');
  expect(family).toContain('GROSS EV ONLY');
});

test('Hobbit family UI never grades incomplete component floors', async()=>{
  const family=await read('src/modules/sealed/product-family.js');
  expect(family).toContain("r.crack_value_basis==='modeled_components'&&!r.crack_value_complete");
  expect(family).toContain('COMPONENT FLOOR');
  expect(family).toContain('extras pending');
  expect(family).toContain('unresolved_pack_components');
  expect(family).toContain('unresolved_other_components');
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
