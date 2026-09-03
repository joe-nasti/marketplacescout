import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Zeta TCG discovery requires exact official-group printing identity', async()=>{
  const src=await read('supabase/functions/secret-lair-zeta-market-sync/index.ts');
  expect(src).toContain("norm(g?.abbreviation)==='slz'");
  expect(src).toContain('allProductsForGroup(Number(group.groupId),t)');
  expect(src).toContain("byKey.set(`${norm(productName(p))}|${norm(cn)}`,p)");
  expect(src).toContain("byKey.get(`${norm(c.card_name)}|${norm(c.collector_number)}`)");
  expect(src).toContain("discovery_status:'confirmed'");
  expect(src).toContain("discovery_source:'tcgplayer_official_group_products'");
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
