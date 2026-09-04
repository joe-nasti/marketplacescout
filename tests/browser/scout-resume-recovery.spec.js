import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Scout rehydrates when an authenticated shell is rebuilt or resumed blank',async()=>{
  const bootstrap=await read('src/modules/scout/bootstrap.js');
  expect(bootstrap).toContain("event.detail?.screen==='app'");
  expect(bootstrap).toContain("window.addEventListener('pageshow'");
  expect(bootstrap).toContain("document.addEventListener('visibilitychange'");
  expect(bootstrap).toContain('host&&host.childElementCount===0');
  expect(bootstrap).toContain('await renderer.load()');
});

test('an in-flight Scout load retries against a replacement shell host',async()=>{
  const renderer=await read('src/modules/scout/renderer.js');
  expect(renderer).toContain("h.isConnected&&document.getElementById('cxScout')===h");
  expect(renderer).toContain("if(document.getElementById('cxScout')!==h)queueMicrotask(()=>load())");
});
