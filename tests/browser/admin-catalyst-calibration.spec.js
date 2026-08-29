import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Admin registers the catalyst calibration module',async()=>{
  const index=await read('src/modules/admin/index.js');
  const module=await read('src/modules/admin/catalyst-calibration.js');
  expect(index).toContain("import('./catalyst-calibration.js')");
  expect(module).toContain("const MIN_SAMPLE=8");
  expect(module).toContain('Official Scout ranking remains unchanged');
  expect(module).toContain('market_intel_catalyst_shadow_backtest_summary');
  expect(module).toContain('market_intel_catalyst_shadow_source_backtest');
  expect(module).not.toContain('update');
  expect(module).not.toContain('delete');
});

test('Catalyst source calibration view is security-invoker and excludes future releases',async()=>{
  const sql=await read('supabase/migrations/20260829023900_catalyst_shadow_source_calibration.sql');
  expect(sql).toContain('with (security_invoker=true)');
  expect(sql).toContain('where not future_release');
  expect(sql).toContain('cross join lateral unnest(b.intel_ids)');
  expect(sql).toContain('revoke all on public.market_intel_catalyst_shadow_source_backtest from anon');
});

test('Catalyst calibration styles retain a mobile single-column source layout',async()=>{
  const css=await read('src/styles/admin-catalyst-calibration.css');
  expect(css).toContain('.cx-cal-grid{display:grid');
  expect(css).toContain('@media(max-width:600px)');
  expect(css).toContain('.cx-cal-source{grid-template-columns:1fr}');
});
