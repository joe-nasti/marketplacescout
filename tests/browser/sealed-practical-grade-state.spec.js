import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('sealed list grades and opportunities use only practical economics', async () => {
  const source=await fs.readFile(new URL('../../src/modules/sealed/renderer.js',import.meta.url),'utf8');
  expect(source).toContain("loadResource('sealed.practicalIndex'");
  expect(source).toContain('practical_scout_score');
  expect(source).toContain('MODEL PENDING');
  expect(source).toContain('Model pending');
  expect(source).not.toContain("r?.scout_sealed_grade||");
  expect(source).not.toContain("r?.scout_sealed_score==null");
});
