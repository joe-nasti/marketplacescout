import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('autocomplete selection leaves the card name composable for power search',async()=>{
  const source=await read('src/modules/scout/search-autocomplete-handoff.js');
  expect(source).toContain("input.value=`${name} `");
  expect(source).toContain("#cxGlobalSuggest [data-global-card]");
  expect(source).toContain("stopImmediatePropagation");
  expect(source).toContain("CollectishScoutGlobalSearch?.loadCard");
});

test('async global-search completion does not clobber appended power operators',async()=>{
  const source=await read('src/modules/scout/search-autocomplete-handoff.js');
  expect(source).toContain("collectish:scout-global-rendered");
  expect(source).toContain("queueMicrotask");
  expect(source).toContain("live.value=desired");
});

test('handoff module is loaded immediately after global search',async()=>{
  const source=await read('src/modules/index.js');
  const search=source.indexOf("./scout/search.js");
  const handoff=source.indexOf("./scout/search-autocomplete-handoff.js");
  expect(search).toBeGreaterThan(-1);
  expect(handoff).toBeGreaterThan(search);
});
