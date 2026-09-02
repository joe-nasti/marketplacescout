import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('sealed set directory labels its numeric rollup as a score, not a product count', async () => {
  const source=await fs.readFile(new URL('../../src/modules/sealed/renderer.js',import.meta.url),'utf8');
  expect(source).toContain("'best score'");
  expect(source).not.toContain("'tracked'</small>");
});
