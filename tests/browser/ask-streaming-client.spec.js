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

test('GitHub Pages requires an explicit Ask stream URL and production build can inject it',async()=>{
  const js=await source('src/modules/ask/streaming.js');
  const config=await source('src/core/config.js');
  const workflow=await source('.github/workflows/deploy-vite-pages.yml');
  expect(js).toContain("!location.hostname.endsWith('github.io')");
  expect(config).toContain('COLLECTISH_ASK_STREAM_URL');
  expect(config).toContain('collectish-ask-stream-url');
  expect(config).toContain('VITE_COLLECTISH_ASK_STREAM_URL');
  expect(workflow).toContain('VITE_COLLECTISH_ASK_STREAM_URL: ${{ vars.COLLECTISH_ASK_STREAM_URL }}');
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
  expect(latency).toContain('cached');
  expect(latency).toContain('prefetched');
  expect(admin).toContain('Streaming latency');
  expect(admin).toContain('Avg TTFT');
  expect(admin).toContain('Clear samples');
});
