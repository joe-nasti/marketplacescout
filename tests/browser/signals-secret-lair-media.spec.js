import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Signals uses stored Secret Lair media and sellout intervals', async()=>{
  const src=await read('src/modules/signals/secret-lair-surface.js');
  expect(src).toContain('secret_lair_assets?');
  expect(src).toContain('secret_lair_sellout_intervals?');
  expect(src).toContain('cx-sl-thumb');
  expect(src).toContain('Supply prior');
  expect(src).toContain('starting allocations may differ');
  expect(src).not.toContain('cdn-prod.scalefast.com');
});

test('Discord v30 resolves Collectish-hosted Secret Lair thumbnails', async()=>{
  const entry=await read('cloud-worker/discord-ask-entry-v30.mjs');
  const media=await read('cloud-worker/discord-secret-lair-media.mjs');
  expect(entry).toContain("./discord-secret-lair-media.mjs");
  expect(entry).toContain('embeds:[embed]');
  expect(media).toContain('secret_lair_assets?');
  expect(media).toContain('thumbnail:{url}');
  expect(media).not.toContain('cdn-prod.scalefast.com');
});

test('asset sync copies official bytes into Collectish storage', async()=>{
  const sync=await read('supabase/functions/secret-lair-assets-sync/index.ts');
  expect(sync).toContain("const BUCKET='secret-lair-assets'");
  expect(sync).toContain("download_status:'downloaded'");
  expect(sync).toContain('content_hash:hash');
  expect(sync).toContain("source:'scalefast_product_api'");
});
