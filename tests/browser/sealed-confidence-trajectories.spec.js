import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('sealed decisions expose confidence, distribution risk, and buy ceilings',async()=>{
  const [sql,ui]=await Promise.all([
    readFile('supabase/migrations/20260903022724_add_sealed_confidence_distribution_analogs.sql','utf8'),
    readFile('src/modules/sealed/renderer.js','utf8')
  ]);
  for(const term of ['practical_p90_estimate','gross_break_even_probability','confidence_score','confidence_label','max_buy_for_15pct_roi','downside_break_even_buy'])expect(sql).toContain(term);
  for(const label of ['Risk & confidence','Practical P10','Practical median','Practical P90','Gross break-even chance','15% ROI max buy','Downside buy ceiling'])expect(ui).toContain(label);
  expect(ui).toContain('before executable-route haircuts');
});

test('collector-box analogs use fetched observations and disclose forecast limits',async()=>{
  const [sql,sync,ui]=await Promise.all([
    readFile('supabase/migrations/20260903022724_add_sealed_confidence_distribution_analogs.sql','utf8'),
    readFile('supabase/functions/sealed-trajectory-history-sync/index.ts','utf8'),
    readFile('src/modules/sealed/renderer.js','utf8')
  ]);
  expect(sql).toContain("p.category='booster_box' and p.subtype='collector'");
  expect(sql).toContain("a.release_date<=t.release_date-180");
  expect(sql).toContain('change_30d_pct');
  expect(sql).toContain('change_90d_pct');
  expect(sql).toContain('units_per_day_30d');
  expect(sync).toContain("['annual','quarter']");
  expect(sync).toContain("requestedRange==='year'?'annual'");
  expect(sync).toContain('apply_marketplace_sales_history');
  expect(ui).toContain('Demand-pattern analogs');
  expect(ui).toContain('descriptive—not forecasts');
});
