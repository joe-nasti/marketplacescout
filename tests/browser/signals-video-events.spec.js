import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('YouTube sync stays native-only and extracts first-class video events',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const sync=await read('supabase/functions/market-intel-youtube-sync/index.ts');
  expect(sync).toContain("mode:'native'");
  expect(sync).toContain('market-intel-video-event-extract');
  expect(sync).toContain('maxTranscripts=Math.max(1,Math.min');
  expect(sync).toContain('events_saved');
  expect(sync).toContain('rss_retry_count:4');
  expect(sync).toContain('native_retry_hours:72');
  expect(sync).toContain('[0,1200,4000,9000]');
});

test('video event extractor enforces graduation threshold and timestamp taxonomy',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const extractor=await read('supabase/functions/market-intel-video-event-extract/index.ts');
  expect(extractor).toContain("'competitive_test'");
  expect(extractor).toContain("'commander_showcase'");
  expect(extractor).toContain("'reprint_reveal'");
  expect(extractor).toContain('prominence<0.55');
  expect(extractor).toContain('A mere card name, decklist inclusion, routine cast');
});

test('Signals and Scout expose timestamped creator catalyst UI',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const ui=await read('src/modules/signals/video-events-ui.js');
  const modules=await read('src/modules/index.js');
  expect(ui).toContain('Watch at');
  expect(ui).toContain('Creator catalysts');
  expect(ui).toContain('Content momentum');
  expect(ui).toContain('market_intel_video_events');
  expect(modules).toContain("import('./signals/video-events-ui.js')");
});
