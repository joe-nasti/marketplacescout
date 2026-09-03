import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Sealed product-family surface is adapter-backed and set-aware', async()=>{
  const index=await read('src/modules/sealed/index.js');
  const family=await read('src/modules/sealed/product-family.js');
  expect(index).toContain("import('./product-family.js')");
  expect(family).toContain('sealed_product_model_coverage?');
  expect(family).toContain('Modeled sealed families');
  expect(family).toContain('coverage_state');
  expect(family).toContain('recommendation_eligible');
  expect(family).toContain('cxSealedFamilySet');
  expect(family).toContain('Practical EV');
  expect(family).toContain('Median est.');
  expect(family).toContain('Top-10 share');
  expect(family).toContain('randomized SYP');
  expect(family).not.toContain('&set_code=eq.HOB');
});

test('coverage gate blocks incomplete sealed recommendations', async()=>{
  const family=await read('src/modules/sealed/product-family.js');
  for(const state of ['COLLATION PARTIAL','COMPONENT FLOOR','UNMODELED'])expect(family).toContain(state);
  expect(family).toContain('recommendation_eligible');
  expect(family).toContain('MODEL PENDING');
  expect(family).toContain('BUY & CRACK');
  expect(family).toContain('known cards only; sealed child excluded');
  expect(family).toContain('Component floors value only known cards');
});

test('generic collation registry preserves Hobbit as first full data profile', async()=>{
  const migration=await read('supabase/migrations/20260902184500_sealed_collation_adapter_registry.sql');
  expect(migration).toContain('sealed_collation_adapters');
  expect(migration).toContain('sealed_collation_profile_bindings');
  expect(migration).toContain('sealed_collation_binding_resolved');
  expect(migration).toContain('sealed_product_model_coverage');
  for(const adapter of ['modern_play_booster_official_v1','modern_collector_booster_official_v1','sealed_composite_children_v1','sealed_deterministic_cards_v1','sealed_container_rollup_v1'])expect(migration).toContain(adapter);
  expect(migration).toContain("'HOB'");
  expect(migration).toContain("'partial'");
  expect(migration).toContain("'deterministic'");
});

test('enabled catalog is provisionally classified without fake collation certainty', async()=>{
  const provisional=await read('supabase/migrations/20260902185000_sealed_enabled_catalog_provisional_bindings.sql');
  const eligibility=await read('supabase/migrations/20260902185200_tighten_sealed_model_coverage_eligibility.sql');
  for(const adapter of ['draft_booster_official_v1','set_booster_official_v1','other_booster_unclassified_v1'])expect(provisional).toContain(adapter);
  expect(provisional).toContain("not in ('HOB','SLD')");
  expect(provisional).toContain("'catalog-provisional-v1'");
  expect(provisional).toContain("'unmodeled'");
  expect(eligibility).toContain("profile_status in ('partial','component_only','unmodeled') then false");
  expect(eligibility).toContain('Adapter family is known but set-specific collation is not hydrated');
});

test('mixed sealed products expose derived Singles and landed-cost decisions', async()=>{
  const index=await read('src/modules/sealed/index.js');
  const compare=await read('src/modules/sealed/source-compare.js');
  expect(index).toContain("import('./source-compare.js')");
  expect(compare).toContain('sealed_single_source_compare_current?');
  expect(compare).toContain('Buy direct');
  expect(compare).toContain('Crack sealed');
  expect(compare).toContain('Best exit');
  expect(compare).toContain('Crack advantage');
  expect(compare).toContain('Open in Scout');
  expect(compare).toContain('Composite product:');
  expect(compare).toContain('Included deck cards are already represented in Optimized Live Out');
  expect(compare).toContain('card_set_code');
  expect(compare).toContain('Your landed acquisition cost');
  expect(compare).toContain('applyScenario');
  expect(compare).toContain('recommendation');
  for (const label of ['BUY & CRACK','FLIP SEALED','MARGINAL CRACK','KEEP SEALED','GROSS EV ONLY','PASS']) expect(compare).toContain(label);
});

test('sealed component cards route internally and composite EV includes child packs', async()=>{
  const renderer=await read('src/modules/sealed/renderer.js');
  const mobile=await read('src/modules/sealed/mobile-economics.js');
  expect(renderer).toContain("u.searchParams.set('tab','scout')");
  expect(renderer).toContain("u.searchParams.set('sku',c.sku_id)");
  expect(renderer).toContain('scoutAnchor(');
  expect(renderer).toContain('u.scout');
  expect(renderer).not.toContain('`,u.scry)');
  expect(mobile).toContain('cx-sealed-mobile-card-link');
  expect(renderer).toContain('sealed_product_child_components?select=child_sealed_uuid,child_product_name,quantity,component_type');
  expect(renderer).toContain('sealed.detail:v9:');
  expect(renderer).toContain("rest('rpc/get_sealed_family_economics_fast'");
  expect(renderer).toContain("floor?'Practical floor':'Practical EV'");
  expect(renderer).toContain("metric('TCG Low EV'");
  expect(renderer).toContain("metric('Practical spread'");
  expect(renderer).toContain('loadListEconomics(products)');
  expect(renderer).not.toContain('sealed_product_family_economics?select=crack_gross_mean_ev');
  expect(renderer).toContain('Included sealed products');
  expect(renderer).toContain('Included packs · TCG Low');
  expect(renderer).toContain('Included packs · practical');
  expect(renderer).toContain('Fixed-card live-out EV');
  expect(renderer).toContain("detailFloor?'Known-card practical floor':'Practical EV'");
  expect(renderer).toContain('EV sensitivity');
  expect(renderer).toContain('Market excluded');
  expect(renderer).toContain('sealed_product_executable_ev_cache?');
  expect(renderer).toContain("known cards only · sample pack excluded");
  expect(renderer).toContain("floor?'COMPONENT FLOOR':'MODEL PENDING'");
  expect(renderer).toContain("if(componentFloor(r))return null");
  const optimizer=await read('src/modules/sealed/out-optimizer.js');
  expect(optimizer).toContain("(num(row.optimized_live_out_ev)||0)+additiveNet");
  expect(optimizer).toContain("(num(row.optimized_with_syp_potential_ev)||0)+additiveNet");
  expect(optimizer).toContain("if(basis.includes('fixed'))fixedChildren+=1");
  expect(optimizer).toContain("else if(basis){randomizedChildren+=1;additiveNet+=value;");
  expect(optimizer).toContain('unresolvedChildren+=1');
  expect(optimizer).toContain('unresolved children fail closed');
  expect(optimizer).toContain("child.selected_exit_route==='sell_sealed'?'Sell child sealed'");
  expect(optimizer).toContain('additiveRoutes');
  expect(optimizer).toContain('Included Products Net');
  expect(optimizer).toContain('Randomized practical out');
  expect(optimizer).toContain('fixed cards only');
  expect(optimizer).toContain('TCG Market, SYP, and last-known Direct remain excluded');
  const audit=await read('supabase/migrations/20260903035910_audit_sealed_composite_ev_routing.sql');
  expect(audit).toContain('with (security_invoker=true)');
  expect(audit).toContain("then 'already_routed'");
  expect(audit).toContain("then 'additive_randomized'");
  expect(audit).toContain("else 'unresolved'");
  expect(audit).toContain('fixed child EV is comparison-only');
  const resale=await read('supabase/migrations/20260903042146_add_sealed_child_resale_fallback.sql');
  expect(resale).toContain('with (security_invoker=true)');
  expect(resale).toContain("'sealed_resale_current_only'::text valuation_basis");
  expect(resale).toContain('collectish_tcg_regular_net(sealed_tcg_low)');
  expect(resale).toContain("p.category='box_set'");
  expect(resale).toContain("p.subtype like 'secret_lair%'");
  expect(resale).toContain('TCG Market and crack EV excluded');
});

test('missing booster-child prices refresh only for the opened parent',async()=>{
  const renderer=await read('src/modules/sealed/renderer.js');
  const fn=await read('supabase/functions/sealed-child-price-refresh/index.ts');
  const migration=await read('supabase/migrations/20260903064000_add_on_demand_sealed_child_pricing.sql');
  expect(renderer).toContain("invokeFunction('sealed-child-price-refresh',{parent_sealed_uuid:parent})");
  expect(renderer).toContain('childPriceRefreshAttempted');
  expect(fn).toContain('parent_sealed_uuid=eq.${encodeURIComponent(parent)}');
  expect(fn).toContain('category=eq.booster_pack');
  expect(fn).toContain('const MAX_CHILDREN=25');
  expect(fn).toContain('const FRESH_MS=12*60*60*1000');
  expect(fn).not.toContain('offset=');
  expect(fn).not.toContain('next_offset');
  expect(migration).toContain("p.category='booster_pack'");
  expect(migration).toContain("'sealed_resale_current_only'::text valuation_basis");
  expect(migration).toContain('TCG Market and crack EV excluded');
  expect(migration).not.toContain('market_price) practical_liquidation_ev');
});

test('booster children choose one exit without double counting',async()=>{
  const renderer=await read('src/modules/sealed/renderer.js');
  const optimizer=await read('src/modules/sealed/out-optimizer.js');
  const migration=await read('supabase/migrations/20260903133915_add_sealed_child_exit_optimization.sql');
  expect(migration).toContain('sealed_child_exit_decision_current');
  expect(migration).toContain('greatest(coalesce(crack_unit_net,0),coalesce(sealed_unit_net,0))');
  expect(migration).toContain("then 'already_routed'");
  expect(migration).toContain("then 'sell_sealed'");
  expect(migration).toContain('selected_unit_net-d.parent_included_unit_net');
  expect(migration).toContain('base practical EV plus only the child-route improvement');
  expect(migration).not.toContain('crack_unit_net+sealed_unit_net');
  expect(renderer).toContain('sealed_product_exit_optimized_current?');
  expect(renderer).toContain('sealed_child_exit_decision_current?');
  expect(optimizer).toContain("child.selected_exit_route==='sell_sealed'");
  expect(optimizer).toContain('Each randomized child contributes exactly one route');
});

test('practical sealed EV discounts liquidity and gates recommendations',async()=>{
  const migration=await read('supabase/migrations/20260903014346_add_sealed_ev_audit_sensitivity.sql');
  expect(migration).toContain('practical_liquidation_ev');
  expect(migration).toContain('top10_practical_ev_share_pct');
  expect(migration).toContain('practical_median_estimate');
  expect(migration).toContain('price_coverage_pct<90');
  expect(migration).toContain("then 'PRICE COVERAGE LOW'");
  expect(migration).toContain("then 'CHASE DEPENDENT'");
  expect(migration).toContain("sealed_low_price*1.15");
  expect(migration).not.toContain('syp_products');
  expect(migration).not.toContain('market_value');
});

test('sealed executable EV uses live price channels and excludes randomized SYP',async()=>{
  const migration=await read('supabase/migrations/20260902223303_sealed_executable_ev_channels.sql');
  expect(migration).toContain('sealed_product_executable_ev_current');
  expect(migration).toContain('collectish_direct_net');
  expect(migration).toContain('collectish_tcg_regular_net');
  expect(migration).toContain('current_only_no_syp');
  expect(migration).toContain('direct_first_net_ev');
  expect(migration).toContain('collectish_live_out_ev');
  expect(migration).not.toContain('syp_products');
  expect(migration).not.toContain('market_value');
});

test('Scout Singles compares buy direct, sealed sourcing and live outlet exit from fast cache', async()=>{
  const index=await read('src/modules/scout/index.js');
  const compare=await read('src/modules/scout/sealed-source-compare.js');
  const sourcing=await read('src/modules/scout/sourcing.js');
  expect(index).toContain("import('./sealed-source-compare.js')");
  expect(compare).toContain('Buy direct · Crack sealed · Best exit');
  expect(compare).toContain('sealed_single_source_compare_current?');
  expect(compare).toContain('ev_allocated_acquisition_per_copy');
  expect(compare).toContain('card_set_code=eq.');
  expect(compare).toContain("import { bestExitQuoteFromScoutRow, normalizeAcquisitionQuote, SOURCING_CHANNELS } from './sourcing.js'");
  expect(compare).toContain('bestExitQuoteFromScoutRow(row)');
  expect(sourcing).toContain("label:'TCG Direct',net:positive(row.direct_net_est)");
  expect(sourcing).toContain("label:'Card Kingdom',net:positive(row.ck_buylist)");
  expect(sourcing).toContain("label:'ManaPool',net:positive(row.manapool_net_est)");
  expect(compare).toContain('Best live exit');
  expect(compare).not.toContain("rest('rpc/sealed_single_source_compare'");
});

test('Play Booster backtest preserves rounded-probability caveat', async()=>{
  const migrations=await read('supabase/migrations/20260902145500_hobbit_play_booster_backtest_runner.sql');
  expect(migrations).toContain('run_hobbit_play_backtest');
  expect(migrations).toContain('rounded <1% residual');
  expect(migrations).toContain('eligible pool size');
});

test('Collector Booster pack has a standalone distribution runner', async()=>{
  const migration=await read('supabase/migrations/20260902151500_hobbit_collector_pack_backtest_runner.sql');
  expect(migration).toContain('run_hobbit_collector_pack_backtest');
  expect(migration).toContain('Single Hobbit Collector Booster Monte Carlo');
  expect(migration).toContain('no box topper');
});
