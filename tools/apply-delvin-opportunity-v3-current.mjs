import fs from 'node:fs';
const presenterPath='supabase/functions/ask-collectish-delvin-supply-present/index.ts';
const guardPath='tools/check-ask-market-wide-supply.mjs';
let s=fs.readFileSync(presenterPath,'utf8');
const must=(needle,label)=>{if(!s.includes(needle))throw new Error(`missing patch anchor: ${label}`)};

// Compact set ladder notation: no star = nonfoil, star = foil.
const oldCompact="function compactRow(r:any,marketContext:any,metadata:any){const p=rowPrice(r,marketContext),rarity=rarityLabel(metadataFor(r,metadata)?.rarity);return`**#${t(r.collector_number)}**${p?` · **${money(p)}**`:''} · ${fmt(r.unit_count)} units${rarity?` · ${rarity}`:''}`}";
const newCompact="function compactRow(r:any,marketContext:any,metadata:any){const p=rowPrice(r,marketContext),rarity=rarityLabel(metadataFor(r,metadata)?.rarity),star=finish(r.finish)==='FOIL'?'★':'';return`**${star}${t(r.collector_number)}**${p?` · **${money(p)}**`:''} · ${fmt(r.unit_count)} units${rarity?` · ${rarity}`:''}`}";
must(oldCompact,'compactRow');s=s.replace(oldCompact,newCompact);
s=s.replace("parts.push(`**Foil**\\n${fo.map(r=>compactRow(r,marketContext,metadata)).join('\\n')}`)","parts.push(`**Foil · ★**\\n${fo.map(r=>compactRow(r,marketContext,metadata)).join('\\n')}`)");

// Canonical v3 opportunity renderer: demand + sourced pull odds.
const helper=String.raw`
function opportunityTextV3(opportunity:any){
  const rows=Array.isArray(opportunity?.rows)?opportunity.rows:[];
  const candidates=rows.filter((r:any)=>{const c=t(r.opportunity_classification),p=t(r.pull_value_status);return c.startsWith('WORTH_INVESTIGATING')||c==='WATCH'||p==='UNDERPRICED_FOR_PULL_RARITY_CANDIDATE'||p==='PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED'});
  const rank=(r:any)=>{const c=t(r.opportunity_classification),p=t(r.pull_value_status),d=t(r.demand_status);if(p==='UNDERPRICED_FOR_PULL_RARITY_CANDIDATE')return 0;if(d==='CONFIRMED'&&c.startsWith('WORTH_INVESTIGATING'))return 1;if(p==='PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED')return 2;if(c==='WORTH_INVESTIGATING_DEMAND_UNKNOWN')return 3;if(c==='WORTH_INVESTIGATING_DEMAND_THIN')return 4;if(c==='WATCH')return 5;return 9};
  return [...candidates].sort((a:any,b:any)=>rank(a)-rank(b)||Number(b.pull_rarity_price_gap||b.scarcity_price_gap||0)-Number(a.pull_rarity_price_gap||a.scarcity_price_gap||0)).slice(0,4).map((r:any)=>{
    const star=finish(r.finish)==='FOIL'?'★':'',label=t(r.set_code)+' '+star+t(r.collector_number),price=Number(r.market_price)>0?money(r.market_price):null;
    const scarcity=Number(r.scarcity_multiple_vs_base),premium=Number(r.price_premium_vs_base),bits:string[]=[];
    if(Number.isFinite(scarcity)&&scarcity>0&&Number.isFinite(premium)&&premium>0)bits.push(scarcity.toFixed(1)+'× scarcer / '+premium.toFixed(2)+'× price');
    if(Number(r.packs_per_hit)>0)bits.push('~1/'+fmt(Math.round(Number(r.packs_per_hit)))+' Collector Boosters');
    if(Number(r.pull_rarity_multiple_vs_sourced_peer)>1&&Number(r.price_multiple_vs_sourced_peer)>0)bits.push(Number(r.pull_rarity_multiple_vs_sourced_peer).toFixed(1)+'× harder to pull vs '+(finish(r.sourced_peer_finish)==='FOIL'?'★':'')+t(r.sourced_peer_collector_number)+' / '+Number(r.price_multiple_vs_sourced_peer).toFixed(2)+'× price');
    const d=t(r.demand_status);if(d==='CONFIRMED')bits.push('demand confirmed'+(Number(r.quarter_quantity_sold)>=0?' · '+fmt(r.quarter_quantity_sold)+' sold/90d'+(Number(r.qty_per_day_90d)>0?' (~'+Number(r.qty_per_day_90d).toFixed(2)+'/d)':''):'') );else if(d==='THIN')bits.push('demand thin');else bits.push('demand unknown');
    const p=t(r.pull_value_status),c=t(r.opportunity_classification);let status='Watch';if(p==='UNDERPRICED_FOR_PULL_RARITY_CANDIDATE')status='**Underpriced-for-pull-rarity candidate**';else if(p==='PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED')status='**Pull-rarity value signal**';else if(c.startsWith('WORTH_INVESTIGATING'))status='**Worth investigating**';
    return '• **'+label+(price?' · '+price:'')+'** — '+bits.join(' · ')+' · '+status;
  }).join('\\n');
}
`;
must('\nDeno.serve(async req=>','Deno serve');s=s.replace('\nDeno.serve(async req=>',helper+'\nDeno.serve(async req=>');

const oldPromise="const [concentration,trend,metadata]=await Promise.all([rpc('ask_collectish_family_supply_concentration_v1',{p_sku_ids:skus}).catch(()=>null),rpc('ask_collectish_family_supply_trend_v1',{p_sku_ids:skus,p_days:90}).catch(()=>null),rpc('ask_collectish_family_printing_metadata_v1',{p_sku_ids:skus}).catch(()=>null)]);";
const newPromise="const [concentration,trend,metadata,opportunity]=await Promise.all([rpc('ask_collectish_family_supply_concentration_v1',{p_sku_ids:skus}).catch(()=>null),rpc('ask_collectish_family_supply_trend_v1',{p_sku_ids:skus,p_days:90}).catch(()=>null),rpc('ask_collectish_family_printing_metadata_v1',{p_sku_ids:skus}).catch(()=>null),rpc('ask_collectish_family_printing_opportunity_v3',{p_sku_ids:skus}).catch(()=>null)]);";
must(oldPromise,'analytics promise');s=s.replace(oldPromise,newPromise);

const oldLine="const confidence=confidenceText(supply),confidenceScore=Number(supply?.confidence_score),rows=Array.isArray(concentration?.printing_rows)?concentration.printing_rows:[],opps=opportunityRows(rows,marketContext,metadata),oppText=opportunityText(opps,marketContext);";
const newLine="const confidence=confidenceText(supply),confidenceScore=Number(supply?.confidence_score),rows=Array.isArray(concentration?.printing_rows)?concentration.printing_rows:[],opps=opportunityRows(rows,marketContext,metadata),oppText=opportunityTextV3(opportunity)||opportunityText(opps,marketContext);";
must(oldLine,'opportunity use');s=s.replace(oldLine,newLine);

const oldFoot="Research signal only — demand/velocity confirmation is still required.";
const newFoot="Research signal only — demand is shown per printing; pull odds appear only where explicitly sourced.";
must(oldFoot,'buy-side footer');s=s.replace(oldFoot,newFoot);

// Prefer canonical v3 rows in structured data when available.
s=s.replace('printing_opportunity:opps','printing_opportunity:opportunity?.rows||opps');
fs.writeFileSync(presenterPath,s);

let g=fs.readFileSync(guardPath,'utf8');
g=g.replace("if(!/\\*\\*Nonfoil\\*\\*/.test(presenter)||!/\\*\\*Foil\\*\\*/.test(presenter))throw new Error('modern-set supply ladder must bucket nonfoil and foil variants');","if(!/\\*\\*Nonfoil\\*\\*/.test(presenter)||!/\\*\\*Foil · ★\\*\\*/.test(presenter))throw new Error('modern-set supply ladder must bucket nonfoil and foil variants with compact star notation');");
const marker="if(!/explicitRow/.test(presenter))throw new Error('ambiguous collector-number schemes need explicit finish-label fallback');";
const extra="for(const token of ['ask_collectish_family_printing_opportunity_v3','opportunityTextV3','UNDERPRICED_FOR_PULL_RARITY_CANDIDATE','PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED','demand confirmed','demand unknown','Collector Boosters','pull odds appear only where explicitly sourced'])if(!presenter.includes(token))throw new Error(`missing demand/pull-odds presenter token: ${token}`);\\n";
if(!g.includes('opportunityTextV3')){if(!g.includes(marker))throw new Error('guard insertion anchor missing');g=g.replace(marker,extra+marker)}
fs.writeFileSync(guardPath,g);
console.log('Patched current-main Delvin opportunity v3 surface and guard');
