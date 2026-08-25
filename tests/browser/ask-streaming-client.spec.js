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
  expect(js).toContain("/functions/v1/ask-collectish-stream");
  expect(js).toContain('shouldUseFastStream');
  expect(js).toContain("context.screen!=='scout'");
  expect(js).toContain('investigate|purchase list|portfolio');
  expect(fn).toContain("model:'gpt-5-mini'");
  expect(fn).toContain('stream:true');
  expect(fn).toContain('max_completion_tokens:350');
  expect(fn).toContain("reasoning_effort:'minimal'");
  expect(fn).toContain("question");
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
  expect(latency).toContain("COLLECTISH_ASK_LATENCY_V1");
  expect(admin).toContain('Streaming transport:');
  expect(admin).toContain('Supabase fast path');
  expect(admin).toContain('Streaming latency');
  expect(admin).toContain('Avg TTFT');
});
