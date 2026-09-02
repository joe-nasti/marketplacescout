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
  expect(family).toContain('modeled_children_lower_bound');
  expect(family).toContain('BUY & CRACK');
  expect(family).toContain('GROSS EV ONLY');
});

test('Hobbit family UI does not treat partial component EV as complete', async()=>{
  const family=await read('src/modules/sealed/product-family.js');
  expect(family).toContain("!r.crack_value_complete");
  expect(family).toContain('EXTRAS PENDING');
  expect(family).toContain('partial component floor');
});

test('Play Booster backtest preserves rounded-probability caveat', async()=>{
  const migrations=await read('supabase/migrations/20260902145500_hobbit_play_booster_backtest_runner.sql');
  expect(migrations).toContain('run_hobbit_play_backtest');
  expect(migrations).toContain('rounded <1% residual');
  expect(migrations).toContain('eligible pool size');
});
