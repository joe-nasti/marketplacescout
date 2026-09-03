import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260903024527_cardkingdom_supply_and_buylist_history.sql','utf8');
const ck=fs.readFileSync('cloud-worker/cardkingdom-depth-sync.mjs','utf8');
const mana=fs.readFileSync('cloud-worker/manapool-depth-sync.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/vendor-depth-sync.yml','utf8');
for(const token of ['vendor_depth_runs','vendor_item_identities','vendor_depth_current','vendor_depth_events','capture_vendor_depth_change','source_as_of_raw','count_quality']){
  if(!migration.includes(token))throw new Error(`missing vendor-depth schema token: ${token}`);
}
if(/run:\s*node cloud-worker\/manapool-depth-sync\.mjs/.test(workflow))throw new Error('ManaPool depth must not run as a scheduled or broad workflow; invoke exact-card depth on demand');
for(const token of ['condition_values','qty_retail','price_buy','qty_buying','condition_quantity_sum_matches']){
  if(!ck.includes(token))throw new Error(`missing Card Kingdom semantic token: ${token}`);
}
for(const token of ['/products/singles','/buyer/optimizer','/inventory/listings','threshold_price','optimizer_derived']){
  if(!mana.includes(token))throw new Error(`missing Mana Pool depth token: ${token}`);
}
if(/condition_values.*buylist/i.test(ck))throw new Error('Card Kingdom condition_values must never be labeled buylist');
console.log('Vendor depth contract checks passed.');
