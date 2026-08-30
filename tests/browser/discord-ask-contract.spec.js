import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('Discord Ask remains a thin queued client of the stable Ask API', async()=>{
  const worker=read('cloud-worker/discord-ask-worker.mjs');
  expect(worker).toContain("/functions/v1/ask-collectish-api");
  expect(worker).toContain("client: 'discord'");
  expect(worker).toContain('DISCORD_ASK_QUEUE.send');
  expect(worker).toContain('type: 5');
  expect(worker).toContain('flags: EPHEMERAL');
  expect(worker).toContain("message.retry({ delaySeconds:");
  expect(worker).not.toMatch(/from\(['\"](?:scout|signals|seller)/i);
  expect(worker).not.toMatch(/\/rest\/v1\/(?:scout|signals|seller)/i);
});

test('Discord OAuth credentials are isolated from authenticated users', async()=>{
  const migration=read('supabase/migrations/20260830010500_discord_ask_identity_and_sessions.sql');
  expect(migration).toContain('alter table public.discord_collectish_oauth_credentials enable row level security');
  expect(migration).toContain('revoke all on table public.discord_collectish_oauth_credentials from anon, authenticated');
  expect(migration).toContain('grant execute on function public.claim_discord_ask_delivery(text, text) to service_role');
  expect(migration).not.toMatch(/create policy[^;]+discord_collectish_oauth_credentials/is);
});

test('production build publishes the Supabase OAuth consent route', async()=>{
  const main=read('src/main.js');
  const consent=read('src/modules/oauth-consent/main.js');
  const finalizer=read('tools/finalize-vite-build.mjs');
  expect(main).toContain("/\\/oauth\\/consent\\/?$/");
  expect(main).toContain("import('./modules/oauth-consent/main.js')");
  expect(consent).toContain('/auth/v1/oauth/authorizations/');
  expect(consent).toContain('/consent');
  expect(finalizer).toContain("join(dist,'oauth','consent')");
  expect(finalizer).toContain("writeFile(join(oauthDir,'index.html'),oauthHtml)");
});
