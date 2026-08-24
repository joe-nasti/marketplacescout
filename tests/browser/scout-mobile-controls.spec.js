import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Scout saved views do not include a redundant Filters trigger',async()=>{
  const source=await read('src/modules/scout/ia-v2.js');
  const chrome=source.match(/ia\.innerHTML=`([\s\S]*?)`;/)?.[1]||'';
  expect(chrome).toContain('Top');
  expect(chrome).toContain('Quick turns');
  expect(chrome).toContain('Buylist backed');
  expect(chrome).toContain('High velocity');
  expect(chrome).not.toContain('data-scout-filters');
  expect(source).toContain("b.dataset.scoutFilters='1'");
});

test('mobile build badge and theme toggle live in the scrolling document utility strip',async()=>{
  const [css,theme]=await Promise.all([read('src/styles/mobile-quality.css'),read('src/core/theme.js')]);
  expect(theme).toContain("bar.id='cxTopUtilities'");
  expect(theme).toContain('app.prepend(bar)');
  expect(theme).toContain('bar.appendChild(badge)');
  expect(theme).toContain('bar.appendChild(button)');
  expect(css).toContain('#app>.cx-top-utilities');
  expect(css).toContain('position:static!important');
  expect(css).not.toMatch(/#app>\.cx-top-utilities[^}]*position:fixed/);
});
