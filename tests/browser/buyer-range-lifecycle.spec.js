import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('buyer range options reapply from explicit buyer account render lifecycle',async()=>{
  const [account,ranges]=await Promise.all([
    read('src/modules/seller/buyer-account.js'),
    read('src/modules/seller/buyer-range-options.js')
  ]);
  expect(account).toContain("collectish:buyer-account-rendered");
  expect(ranges).toContain("document.addEventListener('collectish:buyer-account-rendered',reapply)");
  expect(ranges).not.toContain('MutationObserver');
  expect(ranges).not.toContain('setInterval(');
});
