import assert from 'node:assert/strict';
import { classifyFamilySupply, manaPoolCoverage } from '../supabase/functions/_shared/family-supply-classification.mjs';
const mp=(quantity=4,age=5)=>({available:true,quantity,cache_age_minutes:age});
const classify=(overrides={})=>classifyFamilySupply({tcgClassification:'THIN',tcgComplete:true,cardKingdom:{usable_for_market_claim:false,quantity:0},manaPoolRows:[],expectedSkuCount:4,...overrides});
const cases=[
 ['incomplete family',classify({tcgComplete:false}),'UNPROVEN','LOW',false,'INCOMPLETE_TCGPLAYER_FAMILY'],
 ['deep TCG only',classify({tcgClassification:'DEEP'}),'UNPROVEN','LOW',false,'COMPLETE_TCGPLAYER_FAMILY_ONLY'],
 ['deep plus CK',classify({tcgClassification:'DEEP',cardKingdom:{usable_for_market_claim:true,quantity:40}}),'DEEP','MEDIUM',false,'TCGPLAYER_DEPTH_WITH_RETAILER_CORROBORATION'],
 ['deep plus two retailers',classify({tcgClassification:'DEEP',cardKingdom:{usable_for_market_claim:true,quantity:40},manaPoolRows:[mp(),mp(),mp()],expectedSkuCount:4}),'DEEP','HIGH',false,'TCGPLAYER_DEPTH_WITH_RETAILER_CORROBORATION'],
 ['thin with partial ManaPool',classify({manaPoolRows:[mp(100),mp(100)],expectedSkuCount:4}),'UNPROVEN','LOW',false,'THIN_TCGPLAYER_NOT_CORROBORATED_ACROSS_RETAILERS'],
 ['thin but CK-heavy',classify({cardKingdom:{usable_for_market_claim:true,quantity:30}}),'MODERATE','MEDIUM',false,'RETAILER_HEAVY_SUPPLY_OFFSETS_THIN_TCGPLAYER'],
 ['thin across all sources',classify({cardKingdom:{usable_for_market_claim:true,quantity:6},manaPoolRows:[mp(2),mp(2),mp(2)],expectedSkuCount:4}),'THIN','HIGH',true,'THIN_ACROSS_TCGPLAYER_AND_TWO_RETAIL_DEPTH_SOURCES'],
 ['stale ManaPool ignored',classify({cardKingdom:{usable_for_market_claim:true,quantity:6},manaPoolRows:[mp(2,121),mp(2,121),mp(2,121)],expectedSkuCount:4}),'UNPROVEN','LOW',false,'THIN_TCGPLAYER_NOT_CORROBORATED_ACROSS_RETAILERS'],
];
for(const [name,result,label,confidence,thin,basis] of cases){assert.equal(result.global_supply_classification,label,name);assert.equal(result.confidence,confidence,name);assert.equal(result.market_wide_thinness_proven,thin,name);assert.equal(result.claim_basis,basis,name)}
const tcgOnly=cases[1][1],twoRetailers=cases[3][1],stale=classify({tcgClassification:'DEEP',tcgFresh:false});
assert.equal(tcgOnly.confidence_score,60);assert.deepEqual(tcgOnly.blocking_reasons,['CARDKINGDOM_MISSING','MANAPOOL_FRESH_COVERAGE_BELOW_75_PERCENT']);assert.equal(tcgOnly.confidence_reasons.length,3);
assert.equal(twoRetailers.confidence_score,100);assert.deepEqual(twoRetailers.blocking_reasons,[]);
assert.equal(stale.global_supply_classification,'UNPROVEN');assert.equal(stale.confidence,'LOW');assert.equal(stale.claim_basis,'STALE_TCGPLAYER_FAMILY');assert.ok(stale.blocking_reasons.includes('AGING_TCGPLAYER_SNAPSHOT'));
const adequate=manaPoolCoverage([mp(),mp(),mp()],4),partial=manaPoolCoverage([mp(),mp()],4);assert.equal(adequate.adequate,true);assert.equal(adequate.coverage_pct,75);assert.equal(adequate.usable_sku_count,3);assert.equal(adequate.oldest_age_minutes,5);assert.equal(partial.adequate,false);assert.equal(partial.coverage_pct,50);
console.log(`Family supply classification calibration passed: ${cases.length} archetypes`);
