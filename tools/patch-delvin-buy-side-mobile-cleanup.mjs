import fs from 'node:fs';
const p='supabase/functions/ask-collectish-delvin-supply-present/index.ts';
let s=fs.readFileSync(p,'utf8');
const start=s.indexOf('function opportunityTextV3(opportunity:any){');
const end=s.indexOf('\nDeno.serve(',start);
if(start<0||end<0) throw new Error('opportunityTextV3/Deno.serve anchors not found');
const tail=s.slice(start,end);
const fnEnd=tail.indexOf('\n}\n',tail.indexOf("}).join"));
if(fnEnd<0) throw new Error('opportunityTextV3 end not found');
const replacement=`function opportunityTextV3(opportunity:any){
  const rows=Array.isArray(opportunity?.rows)?opportunity.rows:[];
  const candidates=rows.filter((r:any)=>{const c=t(r.opportunity_classification),p=t(r.pull_value_status);return c.startsWith('WORTH_INVESTIGATING')||c==='WATCH'||p==='UNDERPRICED_FOR_PULL_RARITY_CANDIDATE'||p==='PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED'});
  const rank=(r:any)=>{const c=t(r.opportunity_classification),p=t(r.pull_value_status),d=t(r.demand_status);if(p==='UNDERPRICED_FOR_PULL_RARITY_CANDIDATE')return 0;if(d==='CONFIRMED'&&c.startsWith('WORTH_INVESTIGATING'))return 1;if(p==='PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED')return 2;if(c==='WORTH_INVESTIGATING_DEMAND_UNKNOWN')return 3;if(c==='WORTH_INVESTIGATING_DEMAND_THIN')return 4;if(c==='WATCH')return 5;return 9};
  return [...candidates].sort((a:any,b:any)=>rank(a)-rank(b)||Number(b.pull_rarity_price_gap||b.scarcity_price_gap||0)-Number(a.pull_rarity_price_gap||a.scarcity_price_gap||0)).slice(0,4).map((r:any)=>{
    const star=finish(r.finish)==='FOIL'?'★':'',label=t(r.set_code)+' '+star+t(r.collector_number),price=Number(r.market_price)>0?money(r.market_price):null;
    const scarcity=Number(r.scarcity_multiple_vs_base),premium=Number(r.price_premium_vs_base),detail:string[]=[];
    if(Number.isFinite(scarcity)&&scarcity>0&&Number.isFinite(premium)&&premium>0)detail.push(scarcity.toFixed(1)+'× scarcer / '+premium.toFixed(2)+'× price');
    if(Number(r.packs_per_hit)>0)detail.push('~1/'+fmt(Math.round(Number(r.packs_per_hit)))+' Collector Boosters');
    if(Number(r.pull_rarity_multiple_vs_sourced_peer)>1&&Number(r.price_multiple_vs_sourced_peer)>0)detail.push(Number(r.pull_rarity_multiple_vs_sourced_peer).toFixed(1)+'× harder vs '+(finish(r.sourced_peer_finish)==='FOIL'?'★':'')+t(r.sourced_peer_collector_number)+' / '+Number(r.price_multiple_vs_sourced_peer).toFixed(2)+'× price');
    const d=t(r.demand_status);if(d==='CONFIRMED')detail.push(fmt(r.quarter_quantity_sold)+' sold/90d'+(Number(r.qty_per_day_90d)>0?' (~'+Number(r.qty_per_day_90d).toFixed(2)+'/d)':''));else if(d==='THIN')detail.push('demand thin');else detail.push('demand unknown');
    const p=t(r.pull_value_status),c=t(r.opportunity_classification);let status='Watch';if(p==='UNDERPRICED_FOR_PULL_RARITY_CANDIDATE')status='Underpriced-for-pull-rarity candidate';else if(p==='PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED')status='Pull-rarity value signal';else if(c.startsWith('WORTH_INVESTIGATING'))status='Worth investigating';
    return '• **'+label+(price?' · '+price:'')+' · '+status+'**\\n  '+detail.join(' · ');
  }).join('\\n');
}`;
s=s.slice(0,start)+replacement+tail.slice(fnEnd+3)+s.slice(end);
s=s.replace("if(oppText)sections.push({heading:'Buy-side watch',kind:'text',text:`${oppText}\\\n\\\nResearch signal only — demand is shown per printing; pull odds appear only where explicitly sourced.`});","if(oppText)sections.push({heading:'Buy-side watch',kind:'text',text:oppText});");
s=s.replace("const footerParts=[isCohort?`${cohortIdentityCount} selected identities · ${cohort.selection_basis||title} · not total family supply`:'English NM/LP',`${supply?.coverage?.complete_sku_count||0}/${scopedTargets.length} TCG complete`,`MP ${mpCovered}/${mpExpected} mapped`];","const footerParts=[isCohort?`${cohortIdentityCount} selected identities · ${cohort.selection_basis||title} · not total family supply`:'English NM/LP',`${supply?.coverage?.complete_sku_count||0}/${scopedTargets.length} TCG complete`,`MP ${mpCovered}/${mpExpected} mapped`,oppText?'Opportunity = research signal; odds only where sourced':null].filter(Boolean);");
fs.writeFileSync(p,s);
console.log('Compact Buy-side watch patched');
