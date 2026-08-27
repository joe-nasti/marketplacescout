import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Scout exposes Signal priority view without mutating grade',async()=>{
  const source=await read('src/modules/signals/scout-badges.js');
  expect(source).toContain("data-signal-filter=\"corroborated\"");
  expect(source).toContain("data-signal-filter=\"emerging\"");
  expect(source).toContain("data-signal-filter=\"none\"");
  expect(source).toContain('signalPriorityScore');
  expect(source).toContain('promoted_score');
  expect(source).toContain('priority_boost');
  expect(source).toContain('grade unchanged');
});

test('Signal priority is a presentation-only sort/filter',async()=>{
  const source=await read('src/modules/signals/scout-badges.js');
  expect(source).toContain('cx-signal-priority-controls');
  expect(source).toContain('applySignalPriorityView');
  expect(source).toContain('dataset.signalPriorityHidden');
  expect(source).not.toContain('row.promoted_score=');
  expect(source).not.toContain('row.promoted_grade=');
});
