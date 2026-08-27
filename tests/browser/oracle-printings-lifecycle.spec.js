import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Oracle printing compare uses Scout lifecycle events instead of DOM observers',async()=>{
  const source=await read('src/modules/scout/oracle-printings.js');
  expect(source).not.toContain('MutationObserver');
  expect(source).toContain("collectish:scout-list-rendered");
  expect(source).toContain('refreshCompareDecorations');
});
