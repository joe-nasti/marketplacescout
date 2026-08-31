const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const weighted=(pairs=[])=>{
  let total=0,weight=0;
  for(const [value,w] of pairs){
    const n=Number(value),ww=Number(w);
    if(!Number.isFinite(n)||!Number.isFinite(ww)||ww<=0)continue;
    total+=clamp(n)*ww;weight+=ww;
  }
  return weight?Number((total/weight).toFixed(2)):null;
};

/**
 * Seed interpretation of a 1-10 expert Secret Lair review.
 * This is intentionally categorical rather than a linear score conversion.
 * Historical outcomes should calibrate this mapping later.
 */
function recommendationFromExpertRating(rating){
  const r=Number(rating);
  if(!Number.isFinite(r))return 'watch';
  if(r>=10)return 'pot_of_gold';
  if(r>=9)return 'strong_buy';
  if(r>=8)return 'buy';
  if(r>=7)return 'selective_buy';
  if(r>=6)return 'speculative';
  if(r>=4)return 'personal_only';
  return 'pass';
}

function expertRatingScore(rating){
  const r=Math.max(1,Math.min(10,Number(rating)||1));
  // Non-linear seed curve: 9-10 should be meaningfully rarer/stronger than 7-8.
  const curve={1:8,2:16,3:24,4:34,5:44,6:56,7:68,8:80,9:91,10:98};
  return curve[Math.round(r)]||50;
}

function collectorScore({cards,treatment,audience,supply,versionOfChoice,blingGap}={}){
  return weighted([
    [treatment,0.34],
    [audience,0.30],
    [versionOfChoice,0.14],
    [blingGap,0.10],
    [cards,0.08],
    [supply,0.04],
  ]);
}

function opportunityScore({cards,treatment,audience,supply,adjustedEvScore,liquidity,confidence=0.5,valueConcentrationRisk=0,reprintCompressionPenalty=0}={}){
  const base=weighted([
    [cards,0.20],
    [treatment,0.14],
    [audience,0.14],
    [supply,0.14],
    [adjustedEvScore,0.22],
    [liquidity,0.16],
  ]);
  if(base==null)return null;
  const riskPenalty=clamp(valueConcentrationRisk)*0.08+clamp(reprintCompressionPenalty)*0.08;
  // Confidence does not create upside; it only discounts uncertain conclusions.
  const confidenceFactor=0.72+0.28*Math.max(0,Math.min(1,Number(confidence)||0));
  return Number(clamp((base-riskPenalty)*confidenceFactor).toFixed(2));
}

function blingGapScore({newTreatmentDesirability,bestExistingPremiumDesirability,premiumAvailabilityPenalty=0}={}){
  const next=clamp(newTreatmentDesirability),existing=clamp(bestExistingPremiumDesirability);
  const availability=clamp(premiumAvailabilityPenalty);
  // 50 is neutral parity; >50 means the new treatment fills a meaningful premium gap.
  return Number(clamp(50+(next-existing)*0.65+availability*0.20).toFixed(2));
}

function evScore({cost,compressionAdjustedEv,expectedNetAfterFees}={}){
  const c=Number(cost),gross=Number(compressionAdjustedEv),net=Number(expectedNetAfterFees);
  if(!(c>0))return null;
  const use=Number.isFinite(net)?net:gross;
  if(!Number.isFinite(use))return null;
  const roi=(use-c)/c;
  // 0% ROI ~ 45, 20% ~ 61, 50% ~ 85, >=75% ~ 100. Negative ROI falls quickly.
  return Number(clamp(45+roi*80).toFixed(2));
}

function recommendationFromOpportunity(score,{collectorScore:collector=null,confidence=0.5}={}){
  const s=Number(score),c=Number(collector),conf=Number(confidence)||0;
  if(!Number.isFinite(s))return 'watch';
  if(s>=92&&conf>=0.72)return 'pot_of_gold';
  if(s>=84)return 'strong_buy';
  if(s>=74)return 'buy';
  if(s>=64)return 'selective_buy';
  if(s>=54)return 'speculative';
  if(s<45&&Number.isFinite(c)&&c>=75)return 'personal_only';
  if(s<45)return 'pass';
  return 'watch';
}

export {
  blingGapScore,
  collectorScore,
  evScore,
  expertRatingScore,
  opportunityScore,
  recommendationFromExpertRating,
  recommendationFromOpportunity,
};
