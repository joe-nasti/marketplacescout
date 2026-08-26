import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

async function source(path){return fs.readFile(path,'utf8')}

test('Ask client uses ReadableStream SSE parsing and abort cancellation',async()=>{
  const js=await source('src/modules/ask/streaming.js');
  expect(js).toContain("response.body.getReader()");
  expect(js).toContain("new TextDecoder('utf-8')");
  expect(js).toContain("event==='meta'");
  expect(js).toContain("event==='delta'");
  expect(js).toContain("parsed.event==='done'");
  expect(js).toContain('new AbortController()');
  expect(js).toContain('active?.controller.abort()');
  expect(js).toContain('cx-ask-stream-retry');
  expect(js).toContain("Stream interrupted");
});

test('Ask markdown renderer batches progressive DOM work with animation frames',async()=>{
  const js=await source('src/modules/ask/markdown.js');
  expect(js).toContain('createProgressiveMarkdownRenderer');
  expect(js).toContain('requestAnimationFrame(flush)');
  expect(js).toContain('cancelAnimationFrame(frame)');
  expect(js).toContain('createStream:createProgressiveMarkdownRenderer');
});

test('Ask streaming transport is loaded after the core Ask module',async()=>{
  const js=await source('src/modules/index.js');
  const main=js.indexOf("import('./ask/main.js')");
  const stream=js.indexOf("import('./ask/streaming.js')");
  expect(main).toBeGreaterThan(-1);
  expect(stream).toBeGreaterThan(main);
});

test('Scout fast streaming defaults to existing Supabase project without Cloudflare dependency',async()=>{
  const js=await source('src/modules/ask/streaming.js');
  const fn=await source('supabase/functions/ask-collectish-stream/index.ts');
  expect(js).toContain('/functions/v1/ask-collectish-stream');
  expect(js).toContain('shouldUseFastStream');
  expect(js).toContain("context.screen!=='scout'");
  expect(fn).toContain("model:'gpt-5-mini'");
  expect(fn).toContain('stream:true');
  expect(fn).toContain('max_completion_tokens:350');
  expect(fn).toContain("reasoning_effort:'minimal'");
});

test('Fast Ask reuses browser Scout snapshot and attaches Signals rollup when available',async()=>{
  const js=await source('src/modules/ask/streaming.js');
  const signals=await source('src/modules/signals/source-rollups.js');
  const fn=await source('supabase/functions/ask-collectish-stream/index.ts');
  expect(js).toContain('compactScout');
  expect(js).toContain('cardSnapshot');
  expect(js).toContain('signalsSnapshot');
  expect(js).toContain('CollectishIntelRollups?.getCompactForRow');
  expect(signals).toContain('independentSources');
  expect(signals).toContain('direction:Number(r.intel_direction_score');
  expect(fn).toContain("contextSource=clientCard?'browser-cache':'server-rpc'");
  expect(fn).toContain('SIGNALS_CONTEXT');
  expect(fn).toContain('signals:Boolean(signals)');
});

test('Fast Ask also attaches actionable emerging Signals when no entity rollup exists',async()=>{
  const bridge=await source('src/modules/ask/actionable-signals-context.js');
  const index=await source('src/modules/index.js');
  expect(bridge).toContain('actionableEmerging?.rows');
  expect(bridge).toContain("source:'actionable_emerging'");
  expect(bridge).toContain('primarySignal');
  expect(bridge).toContain('signalFamilies');
  expect(bridge).toContain('liquidityScore');
  expect(bridge).toContain('marginCushionPct');
  expect(bridge).toContain('signalsSnapshot:merged');
  expect(index).toContain("import('./ask/actionable-signals-context.js')");
});

test('Fast Ask falls back to same-name actionable Signals for alternate printings without pretending the scope is exact',async()=>{
  const bridge=await source('src/modules/ask/actionable-signals-context.js');
  const fn=await source('supabase/functions/ask-collectish-stream/index.ts');
  expect(bridge).toContain("scope:'exact-printing'");
  expect(bridge).toContain("scope:'same-name'");
  expect(bridge).toContain("lower(r.card_name)===name");
  expect(bridge).toContain('sourceProductId');
  expect(bridge).toContain('sourcePrinting');
  expect(fn).toContain('signals_scope:signalScope');
  expect(fn).toContain('If actionable Signals scope is same-name');
});

test('Fast Ask warms preferences once and reuses them without the server preference RPC',async()=>{
  const cache=await source('src/modules/ask/preferences-cache.js');
  const fn=await source('supabase/functions/ask-collectish-stream/index.ts');
  const index=await source('src/modules/index.js');
  expect(cache).toContain('COLLECTISH_ASK_PREFS_CACHE_V1');
  expect(cache).toContain('ask_collectish_get_preferences');
  expect(cache).toContain('preferencesSnapshot');
  expect(index).toContain("import('./ask/preferences-cache.js')");
  expect(fn).toContain("preferencesSource=clientPref?'browser-cache':'server-rpc'");
  expect(fn).toContain('preferences_source:preferencesSource');
});

test('Scout Ask starter bar includes Signals coverage probes that remain fast-path-safe',async()=>{
  const starters=await source('src/modules/ask/signals-starters.js');
  const index=await source('src/modules/index.js');
  expect(starters).toContain('What do Signals say?');
  expect(starters).toContain('Do Signals agree with Scout?');
  expect(starters).toContain('Is momentum early or confirmed?');
  expect(starters).toContain("form.dispatchEvent(new Event('submit'");
  expect(index).toContain("import('./ask/signals-starters.js')");
});

test('Deep and historical requests remain on the canonical V3 tool path',async()=>{
  const js=await source('src/modules/ask/streaming.js');
  expect(js).toContain('investigate|purchase list|portfolio|allocate|rebalance|restock|reprice');
  expect(js).toContain('show me|filter|sort|history|trend');
  expect(js).toContain('what changed|changed since');
});

test('Ask streaming records request headers TTFT total and cache metadata',async()=>{
  const stream=await source('src/modules/ask/streaming.js');
  const latency=await source('src/modules/ask/latency.js');
  const admin=await source('src/modules/ask/admin.js');
  expect(stream).toContain('beginAskLatencySample');
  expect(stream).toContain('latency.headers()');
  expect(stream).toContain('latency.meta(meta)');
  expect(stream).toContain('latency.delta()');
  expect(stream).toContain('latency.finish()');
  expect(latency).toContain('ttftMs');
  expect(latency).toContain('COLLECTISH_ASK_LATENCY_V1');
  expect(admin).toContain('Streaming transport:');
  expect(admin).toContain('Supabase fast path');
  expect(admin).toContain('Streaming latency');
  expect(admin).toContain('Avg TTFT');
});
