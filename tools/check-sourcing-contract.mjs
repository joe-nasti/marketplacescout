import assert from 'node:assert/strict';
import {
  SOURCING_CHANNELS,
  SOURCING_RECOMMENDATIONS,
  normalizeAcquisitionQuote,
  legacyAcquisitionQuotesFromScoutRow,
  buildSourcingPath,
  structuralBasisSignal
} from '../src/modules/scout/sourcing.js';

const incompleteCt0=normalizeAcquisitionQuote({channel:'ct0',unitPrice:8});
assert.equal(incompleteCt0.channel,SOURCING_CHANNELS.CARDTRADER_ZERO);
assert.equal(incompleteCt0.complete,false);
assert.equal(incompleteCt0.shippingMode,'basket_marginal');
assert.ok(incompleteCt0.missing.includes('basket_marginal_shipping'));
assert.ok(incompleteCt0.missing.includes('lead_time'));
assert.ok(incompleteCt0.missing.includes('mapping_confidence'));
assert.equal(buildSourcingPath(incompleteCt0,{net:13}).recommendation,SOURCING_RECOMMENDATIONS.WATCH_IMPORT);

const ct0=normalizeAcquisitionQuote({
  channel:'cardtrader_zero',
  unitPrice:8,
  fees:.2,
  shippingAllocation:.45,
  fxReserve:.1,
  dutiesReserve:.05,
  conditionReserve:.2,
  leadDaysMin:35,
  leadDaysMax:50,
  mappingConfidence:'exact'
});
assert.equal(ct0.complete,true);
assert.equal(ct0.landedUnitCost,9);
const ct0Path=buildSourcingPath(ct0,{channel:'tcgplayer_direct',label:'TCG Direct',net:13},{minRoiPct:20,minProfit:1});
assert.equal(ct0Path.recommendation,SOURCING_RECOMMENDATIONS.IMPORT_CT0);
assert.equal(ct0Path.actionable,true);
assert.equal(Math.round(ct0Path.roiPct*10)/10,44.4);
assert.equal(buildSourcingPath(ct0,{net:13},{catalystWindowDays:14}).recommendation,SOURCING_RECOMMENDATIONS.CATALYST_TOO_SHORT);
assert.equal(buildSourcingPath(ct0,{net:13},{ct0BasketOpen:true}).recommendation,SOURCING_RECOMMENDATIONS.ADD_TO_ZERO);

const ct=normalizeAcquisitionQuote({channel:'ct',unitPrice:10,landedUnitCost:11,leadDaysMax:25,mappingConfidence:'exact'});
assert.equal(buildSourcingPath(ct,{net:15}).recommendation,SOURCING_RECOMMENDATIONS.IMPORT_CT);

const legacy=legacyAcquisitionQuotesFromScoutRow({
  tcg_low:12,
  ct_low:8,
  ct_landed_cost:9.5,
  ct_lead_days_max:30,
  ct_mapping_confidence:'exact',
  ct0_low:7.5,
  ct0_landed_cost:8.75,
  ct0_lead_days_max:45,
  ct0_mapping_confidence:'exact'
});
assert.deepEqual(legacy.map(q=>q.channel),[SOURCING_CHANNELS.TCGPLAYER,SOURCING_CHANNELS.CARDTRADER_DIRECT,SOURCING_CHANNELS.CARDTRADER_ZERO]);
assert.equal(legacy[2].shippingMode,'basket_marginal');

const basis=structuralBasisSignal([{landedAdvantagePct:25},{landedAdvantagePct:30},{landedAdvantagePct:22},{landedAdvantagePct:5}],{thresholdPct:20,minPersistence:.7});
assert.equal(basis.recommendation,SOURCING_RECOMMENDATIONS.STRUCTURAL_GAP);
assert.equal(basis.persistence,.75);

console.log('Scout sourcing contract OK');
