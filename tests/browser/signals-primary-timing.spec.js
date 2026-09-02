import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const indexSource=fs.readFileSync(new URL('../../src/modules/signals/index.js',import.meta.url),'utf8');
const healthSource=fs.readFileSync(new URL('../../src/core/health.js',import.meta.url),'utf8');
const contractsSource=fs.readFileSync(new URL('../../src/state/route-data-contracts.js',import.meta.url),'utf8');

test('primary Signals load records data, render, and ready timing separately',async()=>{
  expect(indexSource).toContain('signals_primary_data_ms');
  expect(indexSource).toContain('signals_primary_render_ms');
  expect(indexSource).toContain('signals_primary_ready_ms');
  expect(healthSource).toContain('Signals primary data');
  expect(healthSource).toContain('Signals primary render');
  expect(healthSource).toContain('Signals primary ready');
});

test('hidden legacy feed is not rendered on the For you critical path',async()=>{
  expect(indexSource).toContain("if(workspace&&!workspace.hidden)renderFeed()");
  expect(indexSource).not.toMatch(/store\.update\('intel',[\s\S]{0,180}renderFeed\(\);renderScanSurface/);
});

test('primary intel query selects only fields consumed by Signals',async()=>{
  expect(indexSource).toContain('const PRIMARY_INTEL_PATH=');
  expect(indexSource).not.toContain('select=*,market_intel_entities(*)');
  expect(contractsSource).not.toContain('select=*,market_intel_entities(*)');
  expect(indexSource).toContain('market_intel_entities(entity_type,entity_name,scryfall_id,product_id,set_code,confidence)');
});
