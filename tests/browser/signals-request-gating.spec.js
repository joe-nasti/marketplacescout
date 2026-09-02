import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Signals defers noncritical scan requests behind the primary feed',async()=>{
  const core=await read('src/modules/signals/index.js');
  expect(core).toContain("collectish:signals-primary-ready");
  expect(core).toContain('setTimeout(()=>void loadSalesResponse(),500)');
  const delays=new Map([
    ['actionable-emerging.js','250'],['cross-source.js','900'],['source-performance.js','1600'],
    ['video-events-ui.js','2200'],['synergy-relationships.js','2800'],
    ['future-card-theses.js','3400'],['market-evaluation.js','4000']
  ]);
  for(const [file,delay] of delays){
    const source=await read(`src/modules/signals/${file}`);
    expect(source).toContain("collectish:signals-primary-ready");
    expect(source).toContain(`,${delay})`);
  }
});

test('primary intel completion does not immediately retrigger secondary requests',async()=>{
  const core=await read('src/modules/signals/index.js');
  expect(core).toContain("source:'primary-load'");
  for(const file of ['actionable-emerging.js','cross-source.js','source-performance.js','video-events-ui.js','synergy-relationships.js','future-card-theses.js','market-evaluation.js']){
    const source=await read(`src/modules/signals/${file}`);
    expect(source).toContain("primary-load");
  }
});

test('view-specific endpoints wait for their Signals view',async()=>{
  const competitive=await read('src/modules/signals/competitive.js');
  const commander=await read('src/modules/signals/commander.js');
  expect(competitive).toContain("dataset.signalsView==='competitive'");
  expect(competitive).toContain("e.detail?.view==='competitive'");
  expect(commander).toContain("dataset.signalsView==='commander'");
  expect(commander).toContain("e.detail?.view==='commander'");
});

test('feed decorators no longer fetch merely because the app became ready',async()=>{
  for(const file of ['video-events-ui.js','synergy-relationships.js','future-card-theses.js','actionable-emerging.js']){
    const source=await read(`src/modules/signals/${file}`);
    expect(source).not.toContain("document.addEventListener('collectish:ready',()=>void load())");
    expect(source).not.toMatch(/\nvoid load\(\);/);
  }
});
