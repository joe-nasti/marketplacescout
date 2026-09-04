import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const proxy=read('src/modules/ask/endpoint-proxy.js');
const modules=read('src/modules/index.js');
const starters=read('src/modules/ask/signals-starters.js');
const discord=read('cloud-worker/discord-shared-delvin-route.mjs');
const webApi=read('supabase/functions/ask-collectish-api-v2/index.ts');
const migration=read('supabase/migrations/20260904170000_shared_delvin_capability_manifest_v1.sql');

if(!proxy.includes('ask-collectish-api-v2'))throw new Error('web Ask is not routed through persisted shared facade');
if(proxy.includes('resolve_delvin_shared_query_v1')||proxy.includes('maybeShared('))throw new Error('client-side deterministic routing still duplicates the server resolver');
if(modules.includes("import('./ask/delvin-market-radar-route.js')"))throw new Error('legacy client Delvin interceptor is still loaded');
if(!starters.includes('get_delvin_capability_manifest_v1'))throw new Error('web starters are not manifest-driven');
if(!discord.includes('ask-collectish-delvin-present-v2'))throw new Error('Discord does not use shared presentation v2');
if(!webApi.includes('ask-collectish-delvin-present-v2'))throw new Error('web persisted facade does not use shared presentation v2');
for(const token of ['ask_collectish_messages','conversation_id','shared_delvin:true','persisted:true'])if(!webApi.includes(token))throw new Error(`web deterministic persistence missing ${token}`);
for(const token of ['get_delvin_capability_manifest_v1','capability_kind','clients','modifier_schema','collectible_cohort_thesis','printing_family','card_investigation'])if(!migration.includes(token))throw new Error(`manifest migration missing ${token}`);
console.log('Delvin web/Discord parity guard passed');