import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const prompts=[
  ['what are the top movers today?','market_radar'],
  ['what should I look at right now?','market_radar'],
  ['what cards are gaining EDH demand this week?','edh_demand_7d'],
  ['what creator-driven cards are moving?','creator_catalysts_7d'],
  ['is there growth left with BLB and BLC raised foils?','collectible_cohort_thesis'],
  ['show me BLC raised foils','treatment_intelligence'],
  ["what's moving in BLB?",'set_intelligence'],
  ['compare all printings of Chatterfang, Squirrel General','printing_family'],
  ["why is Y'shtola moving?",'card_investigation']
];

test('web and Discord share the same v2 presenter and canonical result contract',()=>{
  const web=read('supabase/functions/ask-collectish-api-v2/index.ts');
  const discord=read('cloud-worker/discord-shared-delvin-route.mjs');
  const route=read('supabase/functions/ask-collectish-delvin-route-v2/index.ts');
  const present=read('supabase/functions/ask-collectish-delvin-present-v2/index.ts');
  expect(web).toContain('ask-collectish-delvin-present-v2');
  expect(discord).toContain('ask-collectish-delvin-present-v2');
  expect(route).toContain('canonical_result_id');
  expect(route).toContain('canonical_row_count');
  expect(present).toContain('canonical_result_id');
  expect(present).toContain('canonical_row_count');
  expect(present).toContain('payload:{question:prompt}');
});

test('the exact production parity prompts are registry-owned by v2',()=>{
  const migration=read('supabase/migrations/20260905031400_registry_owned_dynamic_delvin_intents.sql');
  const cached=read('supabase/migrations/20260905023500_delvin_registry_cached_matchers_v1.sql');
  const route=read('supabase/functions/ask-collectish-delvin-route-v2/index.ts');
  expect(route).toContain('resolve_delvin_registry_intent_v2');
  for(const [,expectedRoute] of prompts){
    expect(route).toContain(`'${expectedRoute}'`);
    expect(migration+cached).toContain(expectedRoute);
  }
});

test('collectible parity keeps cumulative cohort semantics and exact identity extraction',()=>{
  const migration=read('supabase/migrations/20260905031400_registry_owned_dynamic_delvin_intents.sql');
  const route=read('supabase/functions/ask-collectish-delvin-route-v2/index.ts');
  expect(route).toContain("p_set_codes:i.set_codes");
  expect(route).toContain("p_treatment:i.treatment");
  expect(migration).toContain("when q like '%raised foil%' then 'Raised Foil'");
  expect(migration).toContain("upper(s.set_code)=upper(m[1])");
  expect(route).toContain("p_card_name:i.card_name");
});
