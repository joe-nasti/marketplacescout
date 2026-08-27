import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('YouTube sync stays native-only and cache-first',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const sync=await read('supabase/functions/market-intel-youtube-sync/index.ts');
  expect(sync).toContain("mode:'native'");
  expect(sync).toContain('market-intel-video-event-extract');
  expect(sync).toContain('maxTranscripts=Math.max(1,Math.min');
  expect(sync).toContain('events_saved');
  expect(sync).toContain('rss_retry_count:4');
  expect(sync).toContain('native_retry_hours:72');
  expect(sync).toContain('reprocessCached');
  expect(sync).toContain('cache_first:true');
});

test('Signals and Scout collapse repeated moments into creator-video card theses',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const ui=await read('src/modules/signals/video-events-ui.js');
  const theses=await read('src/modules/signals/video-theses.js');
  const modules=await read('src/modules/index.js');
  expect(ui).toContain('aggregateVideoTheses');
  expect(ui).toContain('supporting moments');
  expect(ui).toContain('videoThesisCollapsed');
  expect(theses).toContain('video_id');
  expect(theses).toContain('card_name');
  expect(theses).toContain('supporting_count');
  expect(modules).toContain("import('./signals/video-events-ui.js')");
});

test('creator catalysts expose attention versus measured market response',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const ui=await read('src/modules/signals/video-events-ui.js');
  const sql=await read('cloud-worker/video-market-response.sql');
  const workflow=await read('.github/workflows/signals-video-market-response.yml');
  expect(ui).toContain('market_intel_video_market_response');
  expect(ui).toContain('Attention vs market');
  expect(ui).toContain('Market response is measured');
  expect(sql).toContain('market_intel_market_snapshots');
  expect(sql).toContain('capture_due_market_intel_snapshots');
  expect(sql).toContain("'h6'");
  expect(sql).toContain("'h24'");
  expect(sql).toContain("'d30'");
  expect(sql).toContain('security invoker');
  expect(workflow).toContain('capture_due_market_intel_snapshots');
  expect(workflow).toContain('17 * * * *');
});
