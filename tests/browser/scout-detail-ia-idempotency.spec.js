import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sourcePath=path.join(process.cwd(),'src/modules/scout/ia-v2.js');

test('Scout detail IA reconciles Decision and Evidence in place',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const source=await readFile(sourcePath,'utf8');
  expect(source).toContain("const decisions=[...h.querySelectorAll(':scope > .cx-scout-decision')]");
  expect(source).toContain('decisions.forEach(x=>x.remove())');
  expect(source).toContain("const wrappers=[...h.querySelectorAll(':scope > .cx-scout-evidence')]");
  expect(source).toContain('for(const extra of wrappers)');
  expect(source).toContain("!x.closest('.cx-scout-evidence')");
  expect(source).toContain('function scheduleDetail(){for(const ms of [0,120,420])setTimeout(compressDetail,ms)}');
  expect(source).not.toContain('delete h.dataset.cxIa');
  expect(source).not.toContain("h.dataset.cxIa='1'");
});
