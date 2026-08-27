import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signal sorting stays within Scout grade and only A/B receive discovery boost',async()=>{
  const ui=await read('src/modules/signals/scout-badges.js');
  expect(ui).toContain("function gradeRank(row)");
  expect(ui).toContain("return gradeRank(row)>=4?Number(confidenceFor(row)?.priority_boost||0):0");
  expect(ui).toContain('gradeRank(br)-gradeRank(ar)||signalPriorityScore(br)-signalPriorityScore(ar)');
  expect(ui).toContain('Sort within grade + signal');
  expect(ui).toContain('signal boost withheld outside A/B');
});

test('Scout cards expose compact Why now evidence',async()=>{
  const ui=await read('src/modules/signals/scout-badges.js');
  expect(ui).toContain('function compactWhyNow(c)');
  expect(ui).toContain("return`${sources} source${sources===1?'':'s'} · ${stage} · ${signalScope(c)} · ${relativeAge(c.latest_signal_at)}`");
  expect(ui).toContain("badge.title=`Why now:");
  expect(ui).toContain("return'exact SKU'");
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
