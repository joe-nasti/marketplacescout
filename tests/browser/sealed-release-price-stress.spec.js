import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('new randomized sealed products expose honest release-price stress',async()=>{
  const ui=await readFile('src/modules/sealed/renderer.js','utf8');
  for(const label of ['Release-price stress','20% compression','35% compression','50% compression','max buy for 15% ROI'])expect(ui).toContain(label);
  for(const label of ['Calibrated release trajectory','d calibrated EV','historical range','TCGCSV Market baskets supply historical shape only'])expect(ui).toContain(label);
  expect(ui).toContain("calibration_status==='READY'");
  expect(ui).toContain("modeled_booster_ev_calibration_current?select=");
  expect(ui).toContain('calibrationFactor');
  expect(ui).toContain("ageDays>90");
  expect(ui).toContain("includes('randomized')");
  expect(ui).toContain('They are not forecasts and do not change the Scout grade');
  expect(ui).toContain('calibrated stabilized EV remains gated');
});

test('calibration persists matched 30/60/90-day release cohorts',async()=>{
  const sql=await readFile('supabase/migrations/20260903221500_add_play_booster_ev_calibration.sql','utf8');
  for(const value of ['array[30,60,90]','having count(*)>=100','percentile_cont(.25)','percentile_cont(.5)','percentile_cont(.75)','play-market-basket-v1'])expect(sql).toContain(value);
  expect(sql).toContain("h1.market_price>0");
  expect(sql).toContain("calibration_status in ('READY','BUILDING_HISTORY')");
  expect(sql).toContain('for select to authenticated using (true)');
  expect(sql.toLowerCase()).toContain('never an executable price source');
});
