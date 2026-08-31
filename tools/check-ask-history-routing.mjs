import fs from 'node:fs';
const src=fs.readFileSync('supabase/functions/ask-collectish-route-intents/index.ts','utf8');
for (const token of ['historyAlias(q)','ask_collectish_public_card_lookup_v1','ask_card_price_history_v1']) {
  if (!src.includes(token)) throw new Error(`missing shared history routing token: ${token}`);
}
const lookupMigration=fs.readFileSync('supabase/migrations/20260831163500_normalize_ask_slash_command_lookup.sql','utf8');
for (const token of ["^/ask\\s+question", "show|give|find|get|open", 'maybe_set', 'maybe_collector']) {
  if (!lookupMigration.includes(token)) throw new Error(`missing lookup normalization token: ${token}`);
}
const resolverMigration=fs.readFileSync('supabase/migrations/20260831195300_normalize_ask_resolver_history_prompts.sql','utf8');
for (const token of [
  'ask_collectish_public_card_lookup_v1(cleaned, 50)',
  "wanted_finish := 'foil'",
  "wanted_finish := 'nonfoil'",
  "wanted_finish := 'etched'",
  '(?:price|market)\\s+history\\s+(?:for|of)',
  'where wanted_finish is null or m.finish_rank=0'
]) {
  if (!resolverMigration.includes(token)) throw new Error(`missing canonical history resolver token: ${token}`);
}
const historyMigration=fs.readFileSync('supabase/migrations/20260831200700_make_ask_price_history_index_native.sql','utf8');
for (const token of [
  "p_sku_id::text end as sku_key",
  'c.sku_id = p.sku_key',
  'm.sku_id = p.sku_key',
  'h.sku_id = t.sku_id',
  'b.sku_id = t.sku_id',
  'b.user_id = auth.uid()'
]) {
  if (!historyMigration.includes(token)) throw new Error(`missing index-native history token: ${token}`);
}
for (const forbidden of [
  /(?:c|m|h|b)\.sku_id::bigint\s*=/,
  /=\s*(?:c|m|h|b)\.sku_id::bigint/,
  /(?:c|m|h|b)\.product_id::bigint\s*=/,
  /=\s*(?:c|m|h|b)\.product_id::bigint/
]) {
  if (forbidden.test(historyMigration)) throw new Error(`history query reintroduced index-defeating comparison cast: ${forbidden}`);
}
console.log('shared Ask history routing normalization guard passed');
