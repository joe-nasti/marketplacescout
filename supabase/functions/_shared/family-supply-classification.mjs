export function manaPoolCoverage(rows, expectedSkuCount, maxAgeMinutes = 120) {
  const usable = (rows || []).filter(row => row?.available && Number(row?.cache_age_minutes) <= maxAgeMinutes);
  const ratio = expectedSkuCount > 0 ? usable.length / expectedSkuCount : 0;
  const ages = usable.map(row => Number(row?.cache_age_minutes)).filter(Number.isFinite);
  return {
    usable,
    quantity: usable.reduce((sum, row) => sum + Number(row?.quantity || 0), 0),
    expected_sku_count: expectedSkuCount,
    usable_sku_count: usable.length,
    coverage_ratio: ratio,
    coverage_pct: Math.round(ratio * 1000) / 10,
    oldest_age_minutes: ages.length ? Math.max(...ages) : null,
    adequate: ratio >= 0.75,
  };
}

function evidence({ tcgClassification, tcgComplete, tcgFresh = true, cardKingdom, manaPoolRows, expectedSkuCount }) {
  const mp = manaPoolCoverage(manaPoolRows, expectedSkuCount), ckUsable = cardKingdom?.usable_for_market_claim === true, retailerSources = Number(ckUsable) + Number(mp.adequate);
  const ckCoverage = Number(cardKingdom?.mapping_coverage_pct || 0), ckStatus = cardKingdom?.freshness_status || (cardKingdom?.available ? 'UNKNOWN' : 'MISSING');
  const components = {
    tcgplayer: tcgComplete && tcgFresh ? 60 : tcgComplete ? 45 : 0,
    cardkingdom: ckUsable ? 20 : cardKingdom?.available ? Math.min(8, Math.round(ckCoverage / 12.5)) : 0,
    manapool: mp.adequate ? 20 : Math.round(mp.coverage_ratio * 10),
  };
  const reasons = [
    tcgComplete ? `TCGplayer exact-SKU coverage complete${tcgFresh ? ' and fresh' : ' but aging'}` : 'TCGplayer exact-SKU coverage incomplete',
    ckUsable ? `Card Kingdom fresh with ${ckCoverage}% identity coverage` : `Card Kingdom ${String(ckStatus).toLowerCase()}${ckCoverage ? ` with ${ckCoverage}% identity coverage` : ''}`,
    mp.adequate ? `ManaPool fresh coverage adequate at ${mp.coverage_pct}%` : `ManaPool fresh coverage partial at ${mp.coverage_pct}%`,
  ];
  const blockers = [];
  if (!tcgComplete) blockers.push('INCOMPLETE_TCGPLAYER_EXACT_SKU_COVERAGE');
  else if (!tcgFresh) blockers.push('AGING_TCGPLAYER_SNAPSHOT');
  if (!ckUsable) blockers.push(cardKingdom?.available ? `CARDKINGDOM_${String(ckStatus).toUpperCase()}` : 'CARDKINGDOM_MISSING');
  if (!mp.adequate) blockers.push('MANAPOOL_FRESH_COVERAGE_BELOW_75_PERCENT');
  return { mp, ckUsable, retailerSources, confidence_score: components.tcgplayer + components.cardkingdom + components.manapool, confidence_components: components, confidence_reasons: reasons, blocking_reasons: blockers };
}

export function classifyFamilySupply(input) {
  const { tcgClassification, tcgComplete, cardKingdom } = input;
  const e = evidence(input), base = { confidence_score: e.confidence_score, confidence_components: e.confidence_components, confidence_reasons: e.confidence_reasons, blocking_reasons: e.blocking_reasons };
  if (!tcgComplete || input.tcgFresh === false) return { ...base, global_supply_classification: 'UNPROVEN', confidence: 'LOW', market_wide_thinness_proven: false, claim_basis: tcgComplete ? 'STALE_TCGPLAYER_FAMILY' : 'INCOMPLETE_TCGPLAYER_FAMILY', retailer_sources_usable: 0 };
  const mp = e.mp, ckUsable = e.ckUsable, retailerSources = e.retailerSources;
  if (['DEEP', 'MODERATE'].includes(tcgClassification)) {
    if (!retailerSources) return { ...base, global_supply_classification: 'UNPROVEN', confidence: 'LOW', market_wide_thinness_proven: false, claim_basis: 'COMPLETE_TCGPLAYER_FAMILY_ONLY', retailer_sources_usable: 0 };
    return { ...base, global_supply_classification: tcgClassification, confidence: retailerSources === 2 ? 'HIGH' : 'MEDIUM', market_wide_thinness_proven: false, claim_basis: 'TCGPLAYER_DEPTH_WITH_RETAILER_CORROBORATION', retailer_sources_usable: retailerSources };
  }
  if ((ckUsable && Number(cardKingdom.quantity) >= 25) || (mp.adequate && mp.quantity >= 25)) return { ...base, global_supply_classification: 'MODERATE', confidence: retailerSources === 2 ? 'HIGH' : 'MEDIUM', market_wide_thinness_proven: false, claim_basis: 'RETAILER_HEAVY_SUPPLY_OFFSETS_THIN_TCGPLAYER', retailer_sources_usable: retailerSources };
  if (ckUsable && mp.adequate && Number(cardKingdom.quantity) <= 8 && mp.quantity <= 8) return { ...base, global_supply_classification: tcgClassification, confidence: 'HIGH', market_wide_thinness_proven: true, claim_basis: 'THIN_ACROSS_TCGPLAYER_AND_TWO_RETAIL_DEPTH_SOURCES', retailer_sources_usable: 2 };
  return { ...base, global_supply_classification: 'UNPROVEN', confidence: 'LOW', market_wide_thinness_proven: false, claim_basis: 'THIN_TCGPLAYER_NOT_CORROBORATED_ACROSS_RETAILERS', retailer_sources_usable: retailerSources };
}
