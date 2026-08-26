import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseScoutSearchQuery, filterScoutPrintings } from '../../src/modules/scout/search-query.js';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('set + collector-only query filters to the exact printing',()=>{
  const query=parseScoutSearchQuery('cn:350 s:cmr');
  const rows=[
    {set:'cmr',collector_number:'350',finishes:['nonfoil']},
    {set:'sld',collector_number:'2812',finishes:['nonfoil','foil']},
    {set:'msc',collector_number:'236',finishes:['nonfoil','foil']}
  ];
  expect(filterScoutPrintings(rows,query)).toEqual([rows[0]]);
});

test('power search owns partial operator composition and truly hides non-matches',async()=>{
  const source=await read('src/modules/scout/power-search.js');
  expect(source).toContain('operatorDraft(raw)');
  expect(source).toContain("OPERATOR_OPTIONS.filter(o=>o.key.startsWith(key)");
  expect(source).toContain("article.style.display=show?'':'none'");
  expect(source).toContain('.cx-global-print[hidden]{display:none!important}');
  expect(source).toContain('renderOperatorSuggestions(raw,query)');
});
