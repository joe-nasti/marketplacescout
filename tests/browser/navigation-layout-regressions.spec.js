import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('Signals desktop rows map the current scan markup into stable columns',async()=>{
  const css=await readFile('src/styles/signals.css','utf8');
  expect(css).toMatch(/grid-template-areas:\s*["']art stage card source confidence scout market chevron["']/);
  for(const area of ['art','stage','card','source','confidence','scout','market','chevron']){
    expect(css).toMatch(new RegExp(`grid-area:\\s*${area}`));
  }
  expect(css).toMatch(/grid-template-columns:\s*44px 92px minmax\(170px,\s*1\.15fr\)/);
});

test('direct route navigation resets to origin while Back restores scroll',async()=>{
  const source=await readFile('src/app.js','utf8');
  const onPageChange=source.slice(source.indexOf('function onPageChange'),source.indexOf('function onPopState'));
  const onPopState=source.slice(source.indexOf('function onPopState'),source.indexOf('function installNavigation'));
  expect(onPageChange).not.toContain('restoreScroll(next)');
  expect(onPopState).toContain('restoreScroll(currentRoute())');
});
