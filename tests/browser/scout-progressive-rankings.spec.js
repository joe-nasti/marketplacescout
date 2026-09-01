import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=file=>readFile(path.join(process.cwd(),file),'utf8');

test('Scout requests one rendered page before completing the ranking universe',async()=>{
  const cache=await read('src/modules/scout/cache-read.js');
  expect(cache).toContain('const INITIAL_ROWS=120');
  expect(cache).toContain('const FULL_ROWS=500');
  expect(cache).toContain('limit=${INITIAL_ROWS}');
  expect(cache).toContain('limit=${FULL_ROWS}');
  expect(cache).toContain("setTimeout(()=>void expandScoutRankings(options),600)");
  expect(cache).toContain("collectish:scout-rankings-expanded");
});

test('Scout applies the expanded ranking set without rebuilding its shell',async()=>{
  const renderer=await read('src/modules/scout/renderer.js');
  expect(renderer).toContain('function acceptExpandedRankings(event)');
  expect(renderer).toContain("document.addEventListener('collectish:scout-rankings-expanded',acceptExpandedRankings)");
  const handler=renderer.slice(renderer.indexOf('function acceptExpandedRankings'),renderer.indexOf('function install()'));
  expect(handler).toContain('applyFilters()');
  expect(handler).not.toContain('renderShell(');
});
