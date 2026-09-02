import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const zeta=fs.readFileSync('src/modules/signals/secret-lair-zeta.js','utf8');
const page=fs.readFileSync('src/modules/signals/page.js','utf8');

test('Zeta surface is mounted as a randomized Secret Lair product',()=>{
  expect(page).toContain("./secret-lair-zeta.js");
  expect(zeta).toContain('Randomized Secret Lair');
  expect(zeta).toContain('secret_lair_randomized_rarity_odds');
  expect(zeta).toContain('secret_lair_randomized_treatments');
});

test('Zeta uses canonical Color Banding terminology and keeps Rainbow only as alias',()=>{
  expect(zeta).toContain('Color Banding');
  expect(zeta).toContain('alias “Rainbow”');
});

test('Zeta keeps hypothetical pack-count scenarios explicitly non-print-run',()=>{
  expect(zeta).toContain('Hypothetical 100,000-pack scenario');
  expect(zeta).toContain('Collectish does not infer that 100,000 packs exist');
});

test('Zeta waits for treatment-specific markets before claiming pack EV',()=>{
  expect(zeta).toContain('Pack EV waiting for card-market mapping');
  expect(zeta).toContain('mean/median EV');
  expect(zeta).toContain('chase concentration');
});
