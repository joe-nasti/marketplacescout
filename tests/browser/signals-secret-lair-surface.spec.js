import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('Signals composes Secret Lair surface without replacing core renderer', async()=>{
  const page=await fs.readFile('src/modules/signals/page.js','utf8');
  const lazy=await fs.readFile('src/core/lazy-pages.js','utf8');
  expect(page).toContain("import * as core from './index.js'");
  expect(page).toContain("import('./secret-lair-surface.js')");
  expect(page).toContain('await core.install()');
  expect(lazy).toContain("signals:()=>import('../modules/signals/page.js')");
});

test('Secret Lair Signals surface keeps research, scores, regional supply and card EV distinct', async()=>{
  const src=await fs.readFile('src/modules/signals/secret-lair-surface.js','utf8');
  expect(src).toContain('Secret Lair · Pre-sale');
  expect(src).toContain('global supply unknown');
  expect(src).toContain('US / REU / UK');
  expect(src).toContain("evaluation_status==='scored'");
  expect(src).toContain('Research only');
  expect(src).toContain('compression_adjusted_value');
  expect(src).toContain('naive_comparable_value');
  expect(src).toContain('Card EV + provenance');
});

test('live Secret Lair observation contract supports pulled separately from sold out', async()=>{
  const migration=await fs.readFile('supabase/migrations/20260831080500_secret_lair_prediction_ledger.sql','utf8');
  const observe=await fs.readFile('supabase/functions/secret-lair-observe/index.ts','utf8');
  expect(migration).toContain("'sold_out','pulled','unknown'");
  expect(observe).toContain("'available','low_stock','sold_out','pulled','unknown'");
  expect(observe).toContain('elapsed_minutes_from_sale');
});
