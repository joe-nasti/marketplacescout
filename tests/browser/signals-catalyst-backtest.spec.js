import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('catalyst shadow scorer exposes stable snapshot identity',async()=>{
  const src=await read('src/modules/signals/catalyst-shadow-score.js');
  expect(src).toContain("SCORER_VERSION='catalyst-shadow-v1'");
  expect(src).toContain('catalystKey');
  expect(src).toContain('sourceKeys');
  expect(src).toContain('intelIds');
  expect(src).toContain('signalMaxAt');
  expect(src).toContain('futureThesisModifier');
});

test('Scout records shadow snapshots without changing the official score',async()=>{
  const src=await read('src/modules/scout/catalyst-shadow-recorder.js');
  expect(src).toContain("market_intel_catalyst_shadow_snapshots");
  expect(src).toContain("resolution=ignore-duplicates,return=minimal");
  expect(src).toContain('official_score:shadow.baseScore');
  expect(src).toContain('shadow_modifier:shadow.appliedModifier');
  expect(src).toContain('future_release:Boolean(shadow.future)');
  expect(src).not.toContain('promoted_score=');
  expect(src).not.toContain('promoted_grade=');
});

test('backtest schema measures 1 3 7 and 30 day market and sales windows',async()=>{
  const schema=await read('supabase/migrations/20260828022500_catalyst_shadow_outcome_measurement.sql');
  const windows=await read('supabase/migrations/20260828022600_catalyst_shadow_backtest_windows.sql');
  const summary=await read('supabase/migrations/20260828022700_catalyst_shadow_backtest_summary.sql');
  expect(schema).toContain('market_intel_catalyst_shadow_snapshots');
  expect(schema).toContain('security_invoker = true');
  for(const d of ['1d','3d','7d','30d']){
    expect(windows).toContain(`market_price_${d}`);
    expect(windows).toContain(`transactions_${d}`);
    expect(windows).toContain(`quantity_${d}`);
    expect(windows).toContain(`matured_${d}`);
    expect(summary).toContain(`matured_${d}`);
  }
  expect(summary).toContain("'+8..+12'");
  expect(summary).toContain("'-8..-4'");
});
