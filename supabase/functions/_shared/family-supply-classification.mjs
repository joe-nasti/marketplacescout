export function manaPoolCoverage(rows, expectedSkuCount, maxAgeMinutes = 120) {
  const usable = (rows || []).filter(row => row?.available && Number(row?.cache_age_minutes) <= maxAgeMinutes);
  const ratio = expectedSkuCount > 0 ? usable.length / expectedSkuCount : 0;
  return { usable, quantity: usable.reduce((sum, row) => sum + Number(row?.quantity || 0), 0), coverage_ratio: ratio, adequate: ratio >= 0.75 };
}

export function classifyFamilySupply({ tcgClassification, tcgComplete, cardKingdom, manaPoolRows, expectedSkuCount }) {
  if (!tcgComplete) return { global_supply_classification: 'UNPROVEN', confidence: 'LOW', market_wide_thinness_proven: false, claim_basis: 'INCOMPLETE_TCGPLAYER_FAMILY', retailer_sources_usable: 0 };
  const mp = manaPoolCoverage(manaPoolRows, expectedSkuCount), ckUsable = cardKingdom?.usable_for_market_claim === true, retailerSources = Number(ckUsable) + Number(mp.adequate);
  if (['DEEP', 'MODERATE'].includes(tcgClassification)) {
    if (!retailerSources) return { global_supply_classification: 'UNPROVEN', confidence: 'LOW', market_wide_thinness_proven: false, claim_basis: 'COMPLETE_TCGPLAYER_FAMILY_ONLY', retailer_sources_usable: 0 };
    return { global_supply_classification: tcgClassification, confidence: retailerSources === 2 ? 'HIGH' : 'MEDIUM', market_wide_thinness_proven: false, claim_basis: 'TCGPLAYER_DEPTH_WITH_RETAILER_CORROBORATION', retailer_sources_usable: retailerSources };
  }
  if ((ckUsable && Number(cardKingdom.quantity) >= 25) || (mp.adequate && mp.quantity >= 25)) return { global_supply_classification: 'MODERATE', confidence: retailerSources === 2 ? 'HIGH' : 'MEDIUM', market_wide_thinness_proven: false, claim_basis: 'RETAILER_HEAVY_SUPPLY_OFFSETS_THIN_TCGPLAYER', retailer_sources_usable: retailerSources };
  if (ckUsable && mp.adequate && Number(cardKingdom.quantity) <= 8 && mp.quantity <= 8) return { global_supply_classification: tcgClassification, confidence: 'HIGH', market_wide_thinness_proven: true, claim_basis: 'THIN_ACROSS_TCGPLAYER_AND_TWO_RETAIL_DEPTH_SOURCES', retailer_sources_usable: 2 };
  return { global_supply_classification: 'UNPROVEN', confidence: 'LOW', market_wide_thinness_proven: false, claim_basis: 'THIN_TCGPLAYER_NOT_CORROBORATED_ACROSS_RETAILERS', retailer_sources_usable: retailerSources };
}
