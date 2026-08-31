import { test, expect } from '@playwright/test';
import {
  blingGapScore,
  collectorScore,
  compressionAdjustedValue,
  evScore,
  expertRatingScore,
  opportunityScore,
  recommendationFromExpertRating,
  recommendationFromOpportunity,
  roiOpportunityFloor,
} from '../../src/modules/signals/secret-lair-score.js';

test('expert rating seed mapping preserves Pot of Gold semantics', async()=>{
  expect(recommendationFromExpertRating(10)).toBe('pot_of_gold');
  expect(recommendationFromExpertRating(9)).toBe('strong_buy');
  expect(recommendationFromExpertRating(8)).toBe('buy');
  expect(recommendationFromExpertRating(7)).toBe('selective_buy');
  expect(recommendationFromExpertRating(6)).toBe('speculative');
  expect(recommendationFromExpertRating(4)).toBe('personal_only');
  expect(recommendationFromExpertRating(3)).toBe('pass');
  expect(expertRatingScore(10)).toBeGreaterThan(expertRatingScore(9));
});

test('bling gap rewards a clearly superior version with weak existing premium options', async()=>{
  const high=blingGapScore({newTreatmentDesirability:92,bestExistingPremiumDesirability:48,premiumAvailabilityPenalty:65});
  const low=blingGapScore({newTreatmentDesirability:72,bestExistingPremiumDesirability:78,premiumAvailabilityPenalty:10});
  expect(high).toBeGreaterThan(80);
  expect(low).toBeLessThan(55);
});

test('reprint compression never increases a scarce premium comparable', async()=>{
  const light=compressionAdjustedValue({normalBaseline:8,premiumComparable:100,compressionPenalty:25});
  const heavy=compressionAdjustedValue({normalBaseline:8,premiumComparable:100,compressionPenalty:80});
  expect(light).toBeLessThanOrEqual(100);
  expect(heavy).toBeLessThan(light);
  expect(heavy).toBeGreaterThanOrEqual(8);
});

test('collector score can remain high when economics are weak', async()=>{
  const collector=collectorScore({cards:52,treatment:94,audience:96,supply:45,versionOfChoice:88,blingGap:84});
  const ev=evScore({cost:60,compressionAdjustedEv:44,expectedNetAfterFees:35});
  const opportunity=opportunityScore({cards:52,treatment:94,audience:96,supply:45,adjustedEvScore:ev,liquidity:55,confidence:.7,valueConcentrationRisk:55,postFeeRoiPct:-41.7});
  expect(collector).toBeGreaterThan(80);
  expect(opportunity).toBeLessThan(collector);
});

test('opportunity confidence discounts uncertainty rather than manufacturing upside', async()=>{
  const base={cards:88,treatment:90,audience:92,supply:82,adjustedEvScore:90,liquidity:86,valueConcentrationRisk:20,postFeeRoiPct:40};
  const high=opportunityScore({...base,confidence:.9});
  const low=opportunityScore({...base,confidence:.25});
  expect(high).toBeGreaterThan(low);
  expect(recommendationFromOpportunity(high,{collectorScore:91,confidence:.9})).not.toBe('pass');
});

test('strong adjusted post-fee ROI cannot collapse to pass after compression was already applied', async()=>{
  expect(roiOpportunityFloor({roiPct:170,confidence:.9,valueConcentrationRisk:50})).toBe(74);
  expect(roiOpportunityFloor({roiPct:91,confidence:.85,valueConcentrationRisk:45})).toBe(68);
  expect(roiOpportunityFloor({roiPct:170,confidence:.9,valueConcentrationRisk:80})).toBe(68);
  const score=opportunityScore({cards:45,treatment:50,audience:50,supply:50,adjustedEvScore:100,liquidity:40,confidence:.9,valueConcentrationRisk:50,postFeeRoiPct:91});
  expect(score).toBeGreaterThanOrEqual(68);
  expect(recommendationFromOpportunity(score,{collectorScore:58,confidence:.9})).toBe('selective_buy');
});
