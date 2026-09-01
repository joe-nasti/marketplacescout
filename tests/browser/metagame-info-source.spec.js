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

test('Metagame.info uses a bounded Browser Run fallback without accepting challenge text',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-curated-content-sync/index.ts');
  expect(src).toContain("Deno.env.get('CLOUDFLARE_ACCOUNT_ID')");
  expect(src).toContain("Deno.env.get('CLOUDFLARE_BROWSER_RUN_TOKEN')");
  expect(src).toContain('/browser-rendering/markdown');
  expect(src).toContain('blocked_by_challenge');
  expect(src).toContain("rejectResourceTypes:['image','media','font']");
  expect(src).toContain("captureMode='cloudflare_browser_run'");
});
