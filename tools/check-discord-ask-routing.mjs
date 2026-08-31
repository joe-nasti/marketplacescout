import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const fail = (message) => { throw new Error(`[discord-ask-routing] ${message}`); };

const wrangler = JSON.parse(read('cloud-worker/wrangler.discord-ask.json'));
if (wrangler.main !== './discord-ask-entry-v30.mjs') fail(`expected Wrangler main to be v30, got ${wrangler.main}`);

const v30 = read('cloud-worker/discord-ask-entry-v30.mjs');
if (!v30.includes("from './discord-ask-entry.mjs'")) fail('v30 must delegate to the transport entrypoint');
for (const token of ['MTGStocks', 'sellerBoard', 'namedBoard', 'cohortBoard', 'scout-tcgplayer-sku-discovery', 'ask_card_price_history_v1']) {
  if (v30.includes(token)) fail(`v30 contains business-routing token: ${token}`);
}

const api = read('supabase/functions/ask-collectish-api/index.ts');
if (!api.includes("ask-collectish-route-intents")) fail('Ask API must invoke the shared deterministic router');
if (!api.includes("ask-collectish-identity-recovery")) fail('Ask API must invoke shared identity recovery');
if (!api.includes('ensureSession(') || !api.includes('saveMessage(')) fail('deterministic routes must preserve Ask session/message history');

const router = read('supabase/functions/ask-collectish-route-intents/index.ts');
for (const token of ["type:'price_history'", "type:'seller_opportunity_map'", "route:'named_family_seller_map'", "route:'cohort_seller_map'", 'matchMove(']) {
  if (!router.includes(token)) fail(`shared router missing contract token: ${token}`);
}

const recovery = read('supabase/functions/ask-collectish-identity-recovery/index.ts');
if (!recovery.includes('ask_market_move_identity_recovery')) fail('market-move identity discovery must live in shared recovery');

console.log('Discord Ask routing contract OK: transport is thin; shared Ask owns deterministic market routes.');
