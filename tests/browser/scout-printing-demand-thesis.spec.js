import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Scout classifies exact-printing movement instead of treating every isolated move as risk',async()=>{
  const sql=await read('cloud-worker/scout-opportunity-context.sql');
  for(const classification of ['broad_card_demand','reprint_migration','prestige_printing','thin_print_anomaly','unknown_printing_specific']){
    expect(sql).toContain(`'${classification}'`);
  }
  expect(sql).toContain("printing_demand_class in ('reprint_migration','prestige_printing','broad_card_demand')");
  expect(sql).toContain("printing_demand_class='thin_print_anomaly'");
  expect(sql).not.toContain("'related_printing_only'=any(risk_flags)");
});

test('Reprint migration requires a newer released printing and measured exact-SKU sales',async()=>{
  const sql=await read('cloud-worker/scout-opportunity-context.sql');
  expect(sql).toContain('r.newest_family_release_date>s.current_printing_release_date+30');
  expect(sql).toContain('r.newest_family_release_date>=current_date-365');
  expect(sql).toContain('coalesce(s.avg_daily_qty_sold,0)>=0.1');
  expect(sql).toContain('printing_premium_ratio');
  expect(sql).toContain('finish_family_market_median');
});

test('Scout surfaces printing thesis metadata without changing economics',async()=>{
  const ui=await read('src/modules/signals/scout-badges.js');
  expect(ui).toContain('function printingDemandLabel(c)');
  expect(ui).toContain("if(cls==='reprint_migration')return'reprint migration'");
  expect(ui).toContain('Printing thesis');
  expect(ui).toContain('Price vs same-finish family median');
  expect(ui).toContain('Scout grade and economics are unchanged');
});
