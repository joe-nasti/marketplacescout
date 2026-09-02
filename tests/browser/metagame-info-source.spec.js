import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals offers all-category Metagame.info sitemap discovery',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('src/modules/signals/source-collectors.js');
  expect(src).toContain("id:'metagame-info'");
  expect(src).toContain("url:'https://metagame.info/sitemaps/en-us/articles.xml.gz'");
  expect(src).toContain("profile:'expert_editorial'");
  expect(src).not.toContain('metagame.info/en-us/mtg/articles/finance');
});

test('Metagame.info discovery follows its public compressed sitemap',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-curated-content-sync/index.ts');
  expect(src).toContain("new DecompressionStream('gzip')");
  expect(src).toContain("kind==='metagame'?await metagameCandidates");
  expect(src).toContain("/^\\/en-us\\/mtg\\/articles\\/[a-z0-9-]+\\/?$/i");
});

test('expert editorial is analyzed by content rather than tag or author alone',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-analyze/index.ts');
  expect(src).toContain('inspect the full article regardless of its site category or format tag');
  expect(src).toContain('Author expertise raises the relevance');
  expect(src).toContain('negative/pass judgments');
});

test('Metagame.info uses Zyte before exact cached Exa content with bounded retries',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-curated-content-sync/index.ts');
  expect(src).toContain("Deno.env.get('ZYTE_API_KEY')");
  expect(src).toContain("https://api.zyte.com/v1/extract");
  expect(src).toContain("body:JSON.stringify({url:target,browserHtml:true})");
  expect(src).toContain("captureMode='zyte_browser_html'");
  expect(src).toContain("if(zyteFailures>=2)zyteCircuitOpen=true");
  expect(src).toContain("capture_mode:'direct_then_zyte_then_exa'");
  expect(src).toContain("Deno.env.get('EXA_API_KEY')");
  expect(src).toContain("https://api.exa.ai/search");
  expect(src).toContain("maxAgeHours:-1");
  expect(src).toContain("canonicalUrl(String(x?.url||''))===target");
  expect(src).toContain("status=exaReason==='exa_not_indexed'?'awaiting_index':'failed'");
  expect(src).toContain("next_retry_at:exaRetryAt(attemptCount)");
  expect(src).toContain("captureMode='exa_indexed_search'");
  expect(src).not.toContain('/browser-rendering/markdown');
  expect(src).not.toContain("captureMode='cloudflare_browser_run'");
});

test('Metagame challenge detection ignores dormant Cloudflare scripts on real articles',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-curated-content-sync/index.ts');
  expect(src).toContain("title.startsWith('just a moment')");
  expect(src).toContain("const rendered=text(html)");
  expect(src).not.toContain("|\\/cdn-cgi\\/challenge-platform\\/|");
});

test('article ingestion scopes duplicate detection to the canonical source URL',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-ingest/index.ts');
  expect(src).toContain('&source_url=eq.${encodeURIComponent(url)}');
  expect(src).toContain('&limit=100`');
  expect(src).not.toContain('&limit=1000`');
});
