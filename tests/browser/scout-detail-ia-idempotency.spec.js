import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sourcePath=path.join(process.cwd(),'src/modules/scout/renderer.js');

test('Scout renderer owns Decision and Evidence hierarchy directly',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const source=await readFile(sourcePath,'utf8');
  expect(source).toContain('cx-scout-decision');
  expect(source).toContain('cx-scout-execution-primary');
  expect(source).toContain('cx-scout-why-buy');
  expect(source).toContain('cx-scout-evidence');
  expect(source).toContain('cx-scout-evidence-body');
  expect(source).toContain('Best trade');
  expect(source).toContain('Cash floor');
  expect(source).not.toContain('function compressDetail');
  expect(source).not.toContain('scheduleDetail(){for(const ms of [0,120,420])');
  expect(source).not.toContain("querySelectorAll(':scope > .cx-scout-decision')");
});
