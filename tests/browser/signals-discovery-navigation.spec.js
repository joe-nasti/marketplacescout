import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Discovery rows use the explicit Signals to Scout navigation guard',async()=>{
  const [guard,view]=await Promise.all([
    read('src/modules/signals/scout-open-navigation-guard.js'),
    read('src/modules/signals/discovery-view.js')
  ]);
  expect(view).toContain('data-discovery-open');
  expect(guard).toContain('[data-discovery-open]');
  expect(guard).toContain('navigateToScout:true');
  expect(guard).toContain("switchPage?.('scout')");
});

test('Discovery collapses repeated Interests appearances to one card printing row',async()=>{
  const view=await read('src/modules/signals/discovery-view.js');
  expect(view).toContain('function identityKey');
  expect(view).toContain('_discovery_occurrences');
  expect(view).toContain('unique cards');
  expect(view).toContain('seen ${occ}×');
});
