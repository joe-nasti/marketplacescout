import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Scout mobile rows surface decision metrics inside the route-owned row',async()=>{
  const source=await read('src/modules/scout/renderer.js');
  expect(source).toContain('cx-scout-mobile-metrics');
  for(const label of ['Score','Market','Direct','Premium','Velocity','CK BL'])expect(source).toContain(`>${label}<`);
});

test('Scout mobile rows do not depend on off-screen desktop columns',async()=>{
  const source=await read('src/styles/mobile-quality.css');
  expect(source).toContain('#cxParityCards>.cx-scout-dense-row{display:block!important');
  expect(source).toContain('#cxParityCards .cx-scout-mobile-metrics{display:grid');
  expect(source).toContain('#cxParityCards>.cx-scout-dense-row>.cx-scout-dense-score');
  expect(source).toContain('#cxParityCards>.cx-scout-dense-row>.cx-scout-dense-signal{display:none!important}');
});
