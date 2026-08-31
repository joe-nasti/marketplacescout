import fs from 'node:fs';
const src=fs.readFileSync('supabase/functions/ask-collectish-route-intents/index.ts','utf8');
for (const token of ['historyAlias(q)','ask_collectish_public_card_lookup_v1','ask_card_price_history_v1']) {
  if (!src.includes(token)) throw new Error(`missing shared history routing token: ${token}`);
}
const migration=fs.readFileSync('supabase/migrations/20260831163500_normalize_ask_slash_command_lookup.sql','utf8');
for (const token of ["^/ask\\s+question", "show|give|find|get|open", 'maybe_set', 'maybe_collector']) {
  if (!migration.includes(token)) throw new Error(`missing lookup normalization token: ${token}`);
}
console.log('shared Ask history routing normalization guard passed');
