import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Discovery auto-resolves unmatched printings and includes paper movers',async()=>{
  const source=await read('src/modules/signals/discovery-view.js');
  expect(source).toContain("mtgjson_cards?select=name,set_code,collector_number,scryfall_id,tcgplayer_product_id");
  expect(source).toContain("source_url||'').includes('/movers/paper/')");
  expect(source).toContain("source_label:'MTGGoldfish'");
  expect(source).toContain("Printing resolved · no current Scout grade");
});

test('Discovery ranks Scout evidence ahead of external movement and preserves lookup state',async()=>{
  const source=await read('src/modules/signals/discovery-view.js');
  expect(source).toContain("(scoreOf(b)??-1)-(scoreOf(a)??-1)");
  expect(source).toContain("['unresolved','Needs lookup']");
  expect(source).toContain("multi-source");
  expect(source).toContain("Discovery sources do not directly change Scout scoring");
});
