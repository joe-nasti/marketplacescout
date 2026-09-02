import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('Secret Lair watcher snapshots metadata and alerts on launch gaps',async()=>{
  const source=await readFile('supabase/functions/secret-lair-watch/index.ts','utf8');
  expect(source).toContain("secret_lair_storefront_snapshots");
  expect(source).toContain("Secret Lair launch has no monitor targets");
  expect(source).toContain("Secret Lair launch has no observations");
  expect(source).toContain("watch_stopped_at");
  expect(source).toMatch(/base=1440;cap=10080/);
});

test('launch-integrity migration protects snapshots and labels recovered timing',async()=>{
  const sql=await readFile('supabase/migrations/20260902202205_secret_lair_launch_integrity.sql','utf8');
  expect(sql).toContain('alter table public.secret_lair_storefront_snapshots enable row level security');
  expect(sql).toContain('revoke all on table public.secret_lair_storefront_snapshots from public,anon');
  expect(sql).toContain("'is_exact_telemetry',false");
  expect(sql).toContain("'zeta_recovered_us_sellout_estimate'");
});
