import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20260902232822_enable_all_scout_sets_age_tiered.sql',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../cloud-worker/queue-configured-set-refresh.mjs',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/modules/admin/scans.js',import.meta.url),'utf8');

test('Scout age tiers preserve the approved cadence boundaries',()=>{
  for(const fragment of [
    "p_released_at >= current_date - 90 then 6",
    "p_released_at >= current_date - 365 then 12",
    "p_released_at >= current_date - 1095 then 48",
    "p_released_at >= current_date - 1825 then 72",
    "p_released_at >= current_date - 2555 then 168",
    "else 336"
  ]) assert.match(sql,new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('full catalog enrollment is paper-only and routable',()=>{
  assert.match(sql,/where digital=false/);
  assert.match(sql,/tcgplayer_group_id is not null/);
  assert.match(sql,/nullif\(tcgplayer_slug,''\) is not null/);
  assert.match(sql,/set enabled=false[\s\S]+p\.set_slug<>m\.tcgplayer_slug/);
});

test('scheduled worker maintains tiers and manual edits become overrides',()=>{
  assert.match(worker,/sync_scout_age_tiered_profiles/);
  assert.match(admin,/\[336,'Every 2 weeks'\]/);
  assert.match(admin,/cadence_policy:'manual'/);
});
