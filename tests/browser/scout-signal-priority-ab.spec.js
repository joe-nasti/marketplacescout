import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signal sorting stays within Scout grade and only A/B receive discovery boost',async()=>{
  const ui=await read('src/modules/signals/scout-badges.js');
  expect(ui).toContain("function gradeRank(row)");
  expect(ui).toContain("return gradeRank(row)>=4?Number(contextFor(row)?.context_priority_boost||0):0");
  expect(ui).toContain('gradeRank(br)-gradeRank(ar)||signalPriorityScore(br)-signalPriorityScore(ar)');
  expect(ui).toContain('Sort within grade + context');
  expect(ui).toContain('priority/urgency only · grade unchanged');
});

test('Scout cards expose compact Why now evidence',async()=>{
  const ui=await read('src/modules/signals/scout-badges.js');
  expect(ui).toContain('function compactWhyNow(c)');
  expect(ui).toContain('signal_independent_sources');
  expect(ui).toContain('signal_leading_sources');
  expect(ui).toContain('signal_confirming_sources');
  expect(ui).toContain("return bits.join(' · ')");
  expect(ui).toContain("badge.title=`Why now:");
  expect(ui).toContain("label:'exact SKU moving'");
  expect(ui).toContain("label:'related printing only'");
  expect(ui).toContain("return'Oracle family'");
});

test('A/B Signal audit is persistent and diagnostic only',async()=>{
  const sql=await read('cloud-worker/scout-signal-ab-audit.sql');
  expect(sql).toContain('scout_signal_ab_audit');
  expect(sql).toContain("where s.promoted_grade in ('A','B')");
  expect(sql).toContain('signal_confidence_label');
  expect(sql).toContain('signal_scope');
  expect(sql).toContain('multi_source');
  expect(sql).toContain('does not change Scout grade or economics');
});
