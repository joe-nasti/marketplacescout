import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('global Scout search detail routing preserves marketplace row context',async()=>{
  const [nav,detailNav]=await Promise.all([
    read('src/modules/scout/search-detail-navigation.js'),
    read('src/modules/scout/detail-navigation.js')
  ]);
  expect(nav).toContain('function rowFor(article,target)');
  expect(nav).toContain('nav?.open?.(row)');
  expect(detailNav).toContain('return {...detail,...row}');
  expect(detailNav).toContain('...detail,');
});

test('global Scout search reveals the otherwise hidden detail layout',async()=>{
  const source=await read('src/modules/scout/search-detail-navigation.js');
  expect(source).toContain("scout.classList.add('cx-global-search-detail-open')");
  expect(source).toContain('layout.hidden=false');
  expect(source).toContain('.cx-scout-layout>section{display:none!important}');
  expect(source).toContain('#cxParityDetail{display:block!important}');
  expect(source).toContain('restoreGlobalSurface');
});
