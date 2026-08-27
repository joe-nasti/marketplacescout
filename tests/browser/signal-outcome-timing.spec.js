import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Signal outcome SQL separates empirical timing from Scout grade',async()=>{
  const sql=await read('cloud-worker/signal-outcome-timing.sql');
  expect(sql).toContain("'reactive'");
  expect(sql).toContain("'predictive'");
  expect(sql).toContain("'confirming'");
  expect(sql).toContain('pre7_vs_prior23_pct');
  expect(sql).toContain('post7_vs_pre7_pct');
  expect(sql).not.toContain('promoted_score=');
  expect(sql).not.toContain('promoted_grade=');
});

test('Admin Signals audit exposes source timing outcomes',async()=>{
  const source=await read('src/modules/admin/signals-video-audit.js');
  expect(source).toContain('market_intel_source_outcomes?select=');
  expect(source).toContain('reactive');
  expect(source).toContain('predictive');
  expect(source).toContain('Source timing outcomes');
});
