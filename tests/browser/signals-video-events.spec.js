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

test('creator catalyst semantics separate conviction convergence and market reaction',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const ui=await read('src/modules/signals/video-events-ui.js');
  const responseSql=await read('cloud-worker/video-market-response.sql');
  const semanticsSql=await read('cloud-worker/video-market-response-z-semantics.sql');
  const speakerSql=await read('cloud-worker/video-speaker-consensus.sql');
  const speakerFn=await read('supabase/functions/market-intel-video-speaker-enrichment/index.ts');
  const commanderWorkflow=await read('.github/workflows/signals-youtube-commander-backfill.yml');
  const workflow=await read('.github/workflows/signals-video-market-response.yml');
  expect(ui).toContain('<span>Conviction</span>');
  expect(ui).toContain('Catalyst / convergence / market');
  expect(ui).toContain('bounded same-video consensus');
  expect(ui).toContain('multiple speakers in one video remain one independent source for Convergence');
  expect(ui).not.toContain('Attention vs market');
  expect(semanticsSql).toContain("when 'the command zone' then 90");
  expect(semanticsSql).toContain("when 'precon_upgrade' then 96");
  expect(semanticsSql).toContain("when 'competitive_test' then 65");
  expect(speakerSql).toContain('content_conviction_score');
  expect(speakerSql).toContain('qualified_speaker_count');
  expect(speakerSql).toContain("coalesce(v.endorsement_type,'explicit') <> 'echo'");
  expect(speakerSql).toContain('independent_source_count');
  expect(speakerSql).toContain('convergence_score');
  expect(speakerSql).toContain('major_single_source_catalyst');
  expect(speakerFn).toContain('Do NOT invent speaker identity');
  expect(speakerFn).toContain('speaker_confidence<0.70');
  expect(speakerFn).toContain("new Set(['echo','explicit','independent_rationale','independent_action'])");
  expect(commanderWorkflow).toContain('market-intel-video-speaker-enrichment');
  expect(responseSql).toContain('market_intel_market_snapshots');
  expect(responseSql).toContain('capture_due_market_intel_snapshots');
  expect(responseSql).toContain("'h6'");
  expect(responseSql).toContain("'h24'");
  expect(responseSql).toContain("'d30'");
  expect(workflow).toContain('capture_due_market_intel_snapshots');
  expect(workflow).toContain('17 * * * *');
});

test('unreleased creator theses survive until release and stay separate from Scout opportunities',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const futureSql=await read('cloud-worker/future-card-theses.sql');
  const futureFn=await read('supabase/functions/market-intel-future-card-thesis-refresh/index.ts');
  const futureUi=await read('src/modules/signals/future-card-theses.js');
  const modules=await read('src/modules/index.js');
  const commanderWorkflow=await read('.github/workflows/signals-youtube-commander-backfill.yml');
  expect(futureSql).toContain('market_intel_future_card_theses');
  expect(futureSql).toContain("'unreleased_deferred'");
  expect(futureSql).toContain("'release_window'");
  expect(futureSql).toContain('+90');
  expect(futureSql).toContain('security_invoker=true');
  expect(futureFn).toContain('card_release_date');
  expect(futureFn).toContain('captured_as_unreleased');
  expect(futureFn).toContain('refresh_future_card_theses');
  expect(futureUi).toContain('Future card theses');
  expect(futureUi).toContain('separately from actionable Scout opportunities');
  expect(modules).toContain("import('./signals/future-card-theses.js')");
  expect(commanderWorkflow).toContain('market-intel-future-card-thesis-refresh');
});
