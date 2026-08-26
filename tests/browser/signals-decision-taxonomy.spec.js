import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {
  signalLabelFromActionClass,
  signalKindFromActionClass,
  signalKindFromIntelStage,
  signalKindLabel,
  SIGNAL_KIND_RANK,
  SIGNAL_SCAN_STAGES
} from '../../src/modules/signals/decision-taxonomy.js';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals decision taxonomy distinguishes Action Emerging Confirming and Watch',async()=>{
  expect(signalKindFromActionClass('action_now')).toBe('action');
  expect(signalLabelFromActionClass('action_now')).toBe('Action now');
  expect(signalKindFromActionClass('emerging_quick_turn')).toBe('emerging');
  expect(signalLabelFromActionClass('emerging_quick_turn')).toBe('Emerging');
  expect(signalKindFromIntelStage('leading')).toBe('emerging');
  expect(signalKindFromIntelStage('confirming')).toBe('confirming');
  expect(signalKindFromIntelStage('neutral')).toBe('watch');
  expect(signalKindLabel('confirming')).toBe('Confirming');
  expect(signalKindLabel('watch')).toBe('Watch');
  expect(SIGNAL_KIND_RANK).toEqual({action:4,emerging:3,confirming:2,watch:1});
});

test('Signals scan KPIs and filters use the same four decision stages',async()=>{
  const source=await read('src/modules/signals/scan-view.js');
  expect(SIGNAL_SCAN_STAGES).toEqual([
    ['all','All'],['action','Action'],['emerging','Emerging'],['confirming','Confirming'],['watch','Watch']
  ]);
  expect(source).toContain("metric('Action now',action,'ready')");
  expect(source).toContain("metric('Emerging',emerging,'early')");
  expect(source).toContain("metric('Confirming',confirming,'corroborated')");
  expect(source).toContain("metric('Watch',watch,'monitor only')");
  expect(source).toContain('SIGNAL_SCAN_STAGES.map');
  expect(source).not.toContain('verified cards');
  expect(source).not.toContain("metric('Sources'");
  expect(source).toContain('<small>Evidence</small>');
  expect(source).toContain('<small>Confidence</small>');
});

test('scan renderer consumes pure taxonomy instead of reclassifying stages locally',async()=>{
  const source=await read('src/modules/signals/scan-view.js');
  expect(source).toContain('signalKindFromActionClass(r.action_class)');
  expect(source).toContain('signalLabelFromActionClass(r.action_class)');
  expect(source).toContain('signalKindFromIntelStage(item.signal_stage)');
  expect(source).toContain('signalKindLabel(kind)');
  expect(source).toContain('SIGNAL_KIND_RANK[b.kind]-SIGNAL_KIND_RANK[a.kind]');
  expect(source).not.toContain("stage==='leading'?'emerging'");
  expect(source).not.toContain("stage==='confirming'?'confirming'");
});
