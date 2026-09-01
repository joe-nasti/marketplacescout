import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=file=>readFile(path.join(process.cwd(),file),'utf8');

test('mobile shell exposes Scout, Signals, Selling, Ask, and More in that order',async()=>{
  const shell=await read('src/core/shell.js');
  expect(shell).toContain("const PRIMARY_GROUPS=['scout','signals','selling']");
  expect(shell).toContain("${PRIMARY_GROUPS.map(mobileGroup).join('')}${mobileAsk()}");
  expect(shell.indexOf('${mobileAsk()}')).toBeLessThan(shell.indexOf('class="cx-mobile-more"'));
});

test('Ask participates in browser and Android Back instead of owning a second stack',async()=>{
  const ask=await read('src/modules/ask/main.js');
  expect(ask).toContain("u.searchParams.set('overlay','ask')");
  expect(ask).toContain("addEventListener('popstate',syncAskRoute)");
  expect(ask).toContain("history.back();return");
  expect(ask).toContain("writeAskRoute(false,{replace:true})");
});

test('phone Scout detail and Ask leave the persistent bottom navigation available',async()=>{
  const css=await read('src/styles/workbench-secondary.css');
  expect(css).toContain('.cx-ask-root{bottom:calc(56px + env(safe-area-inset-bottom));z-index:9000}');
  expect(css).toContain('#cxScout .cx-scout-layout>aside.cx-mobile-detail-open{inset:0 0 calc(56px + env(safe-area-inset-bottom))!important');
  expect(css).toContain('.cx-ask-fab{display:none!important}');
});
