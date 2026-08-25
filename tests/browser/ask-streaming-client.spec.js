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

test('GitHub Pages requires an explicit Ask stream URL instead of unsafe same-origin api fallback',async()=>{
  const js=await source('src/modules/ask/streaming.js');
  const config=await source('src/core/config.js');
  expect(js).toContain("!location.hostname.endsWith('github.io')");
  expect(config).toContain('COLLECTISH_ASK_STREAM_URL');
  expect(config).toContain('collectish-ask-stream-url');
});
