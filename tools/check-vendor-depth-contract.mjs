import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260903024527_cardkingdom_supply_and_buylist_history.sql','utf8');
const ck=fs.readFileSync('cloud-worker/cardkingdom-depth-sync.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/vendor-depth-sync.yml','utf8');
// Comments document why this workflow is intentionally CK-only. Validate the
// executable YAML rather than treating prose as a configured integration.
const workflowExecutable=workflow.split('\n').filter(line=>!/^\s*#/.test(line)).join('\n');
const scout=fs.readFileSync('src/modules/scout/vendor-depth.js','utf8');
for(const token of ['vendor_depth_runs','vendor_item_identities','vendor_depth_current','vendor_depth_events','capture_vendor_depth_change','source_as_of_raw','count_quality']){
  if(!migration.includes(token))throw new Error(`missing vendor-depth schema token: ${token}`);
}
if(/manapool/i.test(workflowExecutable))throw new Error('Card Kingdom depth workflow must not contain ManaPool paths, options, secrets, or jobs');
if(!workflow.includes('35 11,23 * * *'))throw new Error('Card Kingdom depth must refresh on the 12-hour baseline cadence');
if(!workflow.includes("github.event_name != 'push' || github.ref == 'refs/heads/main'"))throw new Error('Card Kingdom pipeline changes on main must run a deployment smoke sync');
if(!workflow.includes("github.event_name == 'push' && github.ref == 'refs/heads/main'"))throw new Error('Card Kingdom deployment smoke job must execute the actual sync step');
for(const token of ['condition_values','qty_retail','price_buy','qty_buying','condition_quantity_sum_matches']){
  if(!ck.includes(token))throw new Error(`missing Card Kingdom semantic token: ${token}`);
}
if(/Mana Pool ≤ CK bid|Targeted probe pending|threshold_supply/.test(scout))throw new Error('deferred ManaPool-to-CK optimization must not appear in Scout');
if(/condition_values.*buylist/i.test(ck))throw new Error('Card Kingdom condition_values must never be labeled buylist');
console.log('Vendor depth contract checks passed.');
