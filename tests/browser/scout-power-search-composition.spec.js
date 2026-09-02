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

test('ranked power-only searches support set and finish filters without stealing exact-printing queries',async()=>{
  const source=await read('src/modules/scout/power-search.js');
  expect(parseScoutSearchQuery('s:HOB')).toMatchObject({
    nameText:'',
    filters:{setCodes:['HOB'],collectorNumbers:[],finishes:[]}
  });
  expect(parseScoutSearchQuery('s:HOB f:foil')).toMatchObject({
    nameText:'',
    filters:{setCodes:['HOB'],collectorNumbers:[],finishes:['foil']}
  });
  expect(parseScoutSearchQuery('f:foil')).toMatchObject({
    nameText:'',
    filters:{setCodes:[],collectorNumbers:[],finishes:['foil']}
  });
  expect(parseScoutSearchQuery('s:SLD cn:2812')).toMatchObject({
    nameText:'',
    filters:{setCodes:['SLD'],collectorNumbers:['2812'],finishes:[]}
  });

  expect(source).toContain('function rankedListQuery(query)');
  expect(source).toContain("if(query?.nameText||collectorNumbers.length||setCodes.length>1||finishes.length>1)return false");
  expect(source).toContain("if(finishes.some(f=>f==='etched'))return false");
  expect(source).toContain('return Boolean(setCodes.length||finishes.length)');
  expect(source).toContain("if(rankedListQuery(query))return runRankedList(raw,query)");
});

test('ranked power-only searches compose through the native Scout renderer and preserve the deep link',async()=>{
  const source=await read('src/modules/scout/power-search.js');
  expect(source).toContain("field.value=noSetMatch?'__collectish_power_query_no_match__':''");
  expect(source).toContain('if(setEl&&setCode&&!noSetMatch)setEl.value=setName');
  expect(source).toContain("if(foilEl&&finish)foilEl.value=finish==='foil'?'true':'false'");
  expect(source).toContain('renderer.applyFilters()');
  expect(source).toContain('field.value=raw');
  expect(source).toContain('restoreUrlPowerQuery(raw,{setValue,foilValue})');
  expect(source).toContain("p.set('q',raw)");
});

test('ranked power-only searches remain active across native filters and direct-load initialization',async()=>{
  const source=await read('src/modules/scout/power-search.js');
  expect(source).toContain('function onRankedFilterCapture(e)');
  expect(source).toContain('RANKED_FILTER_IDS.has(e.target?.id)');
  expect(source).toContain('timer=setTimeout(()=>runRankedList(raw,query),0)');
  expect(source).toContain("document.addEventListener('collectish:scout-v5-ready',syncCurrentField)");
  expect(source).toContain('syncCurrentField()');
});
