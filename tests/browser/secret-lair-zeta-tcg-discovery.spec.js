import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Zeta TCG discovery requires exact SLZ printing identity', async()=>{
  const src=await read('supabase/functions/secret-lair-zeta-market-sync/index.ts');
  expect(src).toContain("code==='slz'");
  expect(src).toContain('exactName&&best.s.magic&&best.s.cardProduct&&best.s.zetaSet');
  expect(src).toContain("best.s.numberOk?'confirmed':'candidate'");
  expect(src).toContain("status='not_found'");
  expect(src).toContain("tcgplayer_product_id:keep?best?.id||null:null");
  expect(src).not.toContain("status=best.s.score>=.80?'confirmed'");
});

test('only confirmed Zeta mappings can replace Oracle floor values', async()=>{
  const migration=await read('supabase/migrations/20260902045500_secret_lair_zeta_tcgplayer_discovery.sql');
  expect(migration).toContain("m.discovery_status='confirmed'");
  expect(migration).toContain("then 'slz_market'");
  expect(migration).toContain("else 'oracle_floor'");
  expect(migration).toContain('secret_lair_randomized_tcg_discovery_context');
});

test('Zeta Signals exposes exact TCG coverage and does not imply market availability', async()=>{
  const src=await read('src/modules/signals/secret-lair-zeta.js');
  expect(src).toContain('exact TCG mappings');
  expect(src).toContain('Watching for first SLZ TCGplayer products');
  expect(src).toContain('exact card + Magic + SLZ/Zeta + collector number required to confirm');
  expect(src).toContain('secret_lair_randomized_tcgplayer_printings?');
});
