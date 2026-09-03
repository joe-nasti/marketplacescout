import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');

test('sales acceleration exposes concentrated-buying diagnostics',()=>{
  const sql=read('supabase/migrations/20260903002000_add_bulk_spec_watch_to_sales_radar.sql');
  expect(sql).toContain('peak_bucket_qty');
  expect(sql).toContain('peak_bucket_units_per_txn');
  expect(sql).toContain('peak_bucket_qty_share');
  expect(sql).toContain('recent_units_per_txn');
  expect(sql).toContain('baseline_units_per_txn');
  expect(sql).toContain('bulk_buy_flag');
  expect(sql).toContain('bulk_buy_severity');
  expect(sql).toContain('possible spec/buyout activity');
});

test('bulk concentration tempers acceleration without deleting the watch signal',()=>{
  const sql=read('supabase/migrations/20260903002000_add_bulk_spec_watch_to_sales_radar.sql');
  expect(sql).toMatch(/when 'high' then 12 when 'medium' then 6/);
  expect(sql).toMatch(/when 'high' then 8 when 'medium' then 4/);
  expect(sql).toContain('bulk_spec_watch');
  expect(sql).toContain('bulk_spec_severity');
});

test('Discord makes bulk spec behavior explicit in sales and radar output',()=>{
  const worker=read('cloud-worker/discord-fast-query-cache.mjs');
  expect(worker).toContain('BULK/SPEC WATCH');
  expect(worker).toContain('bulk/spec watch');
  expect(worker).toContain('peak_bucket_qty');
  expect(worker).toContain('peak_bucket_qty_share');
  expect(worker).toContain('concentrated buying, not confirmed broad demand');
});
