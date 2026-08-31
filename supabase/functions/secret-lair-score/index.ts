import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const clamp=(v:any,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const money=(v:any)=>Number((Number(v)||0).toFixed(2));
const median=(values:number[])=>{const a=values.filter(v=>Number.isFinite(v)&&v>0).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const weighted=(pairs:any[])=>{let s=0,w=0;for(const [v,ww] of pairs){if(Number.isFinite(Number(v))&&Number(ww)>0){s+=clamp(v)*Number(ww);w+=Number(ww)}}return w?clamp(s/w):50};
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:H(t)});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function evidenceScore(rows:any[],dims:string[],fallback=50){const a=rows.filter(r=>dims.includes(r.claim_dimension));if(!a.length)return fallback;let s=0,w=0;for(const r of a){const n=r.direction==='bullish'?82:r.direction==='bearish'?18:50,ww=Math.max(.15,Number(r.confidence)||.5);s+=n*ww;w+=ww}return clamp(s/w)}
function recommendation(s:number,c:number,conf:number){if(s>=92&&conf>=.72)return'pot_of_gold';if(s>=84)return'strong_buy';if(s>=74)return'buy';if(s>=64)return'selective_buy';if(s>=54)return'speculative';if(s<45&&c>=75)return'personal_only';if(s<45)return'pass';return'watch'}
function evScore(cost:number,net:number){return cost>0&&Number.isFinite(net)?clamp(45+((net-cost)/cost)*80):45}
function roiOpportunityFloor(roi:number,confidence:number,concentration:number){
  if(!(confidence>=.70)||!Number.isFinite(roi))return 0;
  let floor=roi>=100?74:roi>=60?68:roi>=35?62:roi>=20?56:roi>=10?52:roi>=0?47:0;
  // A very concentrated thesis can still be profitable, but should not be promoted
  // above SELECTIVE BUY on economics alone.
  if(concentration>=75)floor=Math.min(floor,68);
  return floor;
}

async function valueCard(t:string,c:any,finish:string){
  const exact=await rest(t,`mtgjson_cards?select=scryfall_oracle_id&name=eq.${encodeURIComponent(c.card_name)}&scryfall_oracle_id=not.is.null&limit=1`).catch(()=>[]);
  const oracle=exact?.[0]?.scryfall_oracle_id;if(!oracle)return{card:c,resolved:false};
  const prints=await rest(t,`mtgjson_cards?select=uuid,set_code,collector_number,release_date&scryfall_oracle_id=eq.${oracle}&order=release_date.desc&limit=200`).catch(()=>[]);
  const uuids=(prints||[]).map((x:any)=>x.uuid).filter(Boolean);if(!uuids.length)return{card:c,resolved:false,oracle};
  const uuidFilter=`(${uuids.join(',')})`;
  const prices=await rest(t,`tcgplayer_preferred_price_current_cache?select=uuid,finish,product_id,market_price,low_price,lowest_listing_price&uuid=in.${uuidFilter}`).catch(()=>[]);
  const skus=await rest(t,`mtgjson_tcgplayer_skus?select=sku_id,uuid,finish&uuid=in.${uuidFilter}&condition=eq.NEAR%20MINT&language=eq.ENGLISH`).catch(()=>[]);
  const skuIds=(skus||[]).map((x:any)=>x.sku_id).filter(Boolean).slice(0,500);let sales:any[]=[];
  if(skuIds.length){const since=new Date(Date.now()-90*864e5).toISOString().slice(0,10);sales=await rest(t,`marketplace_sku_sales_buckets?select=sku_id,quantity_sold&bucket_start_date=gte.${since}&sku_id=in.(${skuIds.join(',')})`).catch(()=>[])}
  const salesBySku=new Map<string,number>();for(const x of sales||[])salesBySku.set(String(x.sku_id),Number(salesBySku.get(String(x.sku_id))||0)+Number(x.quantity_sold||0));
  const salesByUuid=new Map<string,number>();for(const s of skus||[])salesByUuid.set(String(s.uuid),Number(salesByUuid.get(String(s.uuid))||0)+Number(salesBySku.get(String(s.sku_id))||0));
  const targetFinish=finish==='foil'?'foil':'normal';
  const normal=(prices||[]).filter((p:any)=>p.finish==='normal'&&Number(p.market_price)>0),target=(prices||[]).filter((p:any)=>p.finish===targetFinish&&Number(p.market_price)>0);
  const floor=normal.length?Math.min(...normal.map((p:any)=>Number(p.market_price))):null,normalMedian=median(normal.map((p:any)=>Number(p.market_price)));
  const liquid=target.filter((p:any)=>Number(salesByUuid.get(String(p.uuid))||0)>0),pool=liquid.length?liquid:target;
  const comparable=pool.length?Math.max(...pool.map((p:any)=>Number(p.market_price))):null;
  const base=Number(floor||normalMedian||0),comp=Number(comparable||base||0);
  const competing=target.filter((p:any)=>base>0&&Number(p.market_price)>=base*1.5).length,competition=clamp(competing*12);
  const premiumGap=comp>0?clamp(((comp-base)/comp)*100):0;
  const compression=clamp(25+premiumGap*.45+competition*.25,20,92);
  const adjusted=comp>base?base+(comp-base)*(1-compression/100):Math.max(base,comp);
  const totalSales=[...salesByUuid.values()].reduce((a,n)=>a+n,0),targetUuids=new Set(target.map((p:any)=>String(p.uuid)));
  const targetSales=[...salesByUuid.entries()].filter(([id])=>targetUuids.has(id)).reduce((a,[,n])=>a+n,0);
  const liquidity=clamp(Math.log10(1+totalSales)*32),bling=clamp(50+premiumGap*.35-competition*.18);
  return{card:c,resolved:true,oracle,printing_count:uuids.length,premium_count:target.length,normal_floor:base||null,normal_median:normalMedian,liquid_comparable:comparable,premium_sales:targetSales,total_sales:totalSales,competition,compression,bling,naive:comp||base,adjusted,liquidity,coverage:prices.length?Math.min(.95,.45+.5*Math.min(1,prices.length/Math.max(1,uuids.length))):.2,metadata:{liquid_comparable_used:Boolean(liquid.length),priced_printings:prices.length,target_finish:targetFinish,printing_cap_reached:prints.length>=200,normal_baseline:base||null,selected_finish_comparable:comparable||null}};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t)return J({error:'Authentication required'},401);let u:any;try{u=await auth(t)}catch{return J({error:'Authentication required'},401)}
  let b:any;try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
  const dropId=String(b?.drop_id||''),region=['US','REU','UK'].includes(String(b?.region||'').toUpperCase())?String(b.region).toUpperCase():'US',finish=['nonfoil','foil','other'].includes(String(b?.finish||''))?String(b.finish):'nonfoil';if(!dropId)return J({error:'drop_id required'},400);
  try{
    const drops=await rest(t,`secret_lair_drops?select=drop_id,release_id,drop_name&drop_id=eq.${encodeURIComponent(dropId)}&limit=1`),drop=drops?.[0];if(!drop)throw Error('Drop not found');
    const offers=await rest(t,`secret_lair_drop_offers?select=price,currency&drop_id=eq.${encodeURIComponent(dropId)}&region=eq.${region}&finish=eq.${finish}&limit=1`).catch(()=>[]);
    const acquisition=Number(offers?.[0]?.price);if(!(acquisition>0))return J({ok:true,scored:false,reason:'missing_regional_price',drop_name:drop.drop_name,region,finish});
    const cards=await rest(t,`secret_lair_drop_cards?select=drop_card_id,card_name,is_token,is_bonus_card&drop_id=eq.${encodeURIComponent(dropId)}&order=created_at.asc`),relevant=(cards||[]).filter((c:any)=>!c.is_token&&!c.is_bonus_card);
    const evidence=await rest(t,`secret_lair_evidence?select=claim_dimension,direction,confidence,evidence_class&drop_id=eq.${encodeURIComponent(dropId)}&order=observed_at.desc&limit=300`).catch(()=>[]);
    const vals=[];for(const c of relevant)vals.push(await valueCard(t,c,finish));
    const resolved=vals.filter((v:any)=>v.resolved&&Number(v.adjusted)>=0),coverage=relevant.length?resolved.length/relevant.length:0,pricedCoverage=resolved.length?resolved.filter((v:any)=>Number(v.naive)>0).length/resolved.length:0;
    if(coverage<.70||pricedCoverage<.60)return J({ok:true,scored:false,reason:'insufficient_market_coverage',coverage,priced_coverage:pricedCoverage,drop_name:drop.drop_name,region,finish,cards:vals.map((v:any)=>({card_name:v.card.card_name,resolved:v.resolved}))});
    const naive=resolved.reduce((a:number,v:any)=>a+Number(v.naive||0),0),adjusted=resolved.reduce((a:number,v:any)=>a+Number(v.adjusted||0),0),liquidity=resolved.reduce((a:number,v:any)=>a+v.liquidity,0)/resolved.length,top=Math.max(...resolved.map((v:any)=>Number(v.adjusted||0)));
    const anchor=clamp(35+(top/acquisition)*55),depth=clamp(resolved.filter((v:any)=>v.total_sales>0).length/Math.max(1,resolved.length)*100),cardsScore=weighted([[anchor,.45],[depth,.30],[liquidity,.25]]);
    const treatment=evidenceScore(evidence,['art','treatment','version_of_choice','premium_competition','ip_fit'],55),audience=evidenceScore(evidence,['ip_heat','cute_meme_nostalgia','merchandise'],50),supply=50;
    const bling=resolved.reduce((a:number,v:any)=>a+v.bling,0)/resolved.length,collector=weighted([[treatment,.34],[audience,.30],[bling,.22],[cardsScore,.10],[supply,.04]]),compression=resolved.reduce((a:number,v:any)=>a+v.compression,0)/resolved.length,concentration=adjusted>0?clamp(top/adjusted*100):100;
    const net=adjusted*.75,roi=(net-acquisition)/acquisition*100,evs=evScore(acquisition,net),confidence=Math.min(.9,.35+coverage*.30+pricedCoverage*.20+(evidence.length?Math.min(.9,.45+evidence.length*.015)*.15:0));
    let opportunity=weighted([[cardsScore,.20],[treatment,.14],[audience,.14],[supply,.14],[evs,.22],[liquidity,.16]]);
    // Compression has already been applied to adjusted EV. Do not subtract the same
    // reprint/scarcity risk a second time here. Keep a concentration penalty, then
    // let strong post-fee economics establish a conservative minimum tier.
    opportunity=clamp((opportunity-concentration*.08)*(.72+.28*confidence));
    const economicsFloor=roiOpportunityFloor(roi,confidence,concentration);opportunity=Math.max(opportunity,economicsFloor);
    const rec=recommendation(opportunity,collector,confidence);
    const inserted=await rest(t,'secret_lair_evaluations',{method:'POST',prefer:'return=representation',body:[{release_id:drop.release_id,drop_id:drop.drop_id,evaluation_phase:'pre_sale',evaluation_status:'scored',region,finish,cards_score:money(cardsScore),treatment_score:money(treatment),audience_score:money(audience),supply_score:supply,anchor_strength:money(anchor),playable_depth:money(depth),bling_gap:money(bling),premium_competition_penalty:money(resolved.reduce((a:number,v:any)=>a+v.competition,0)/resolved.length),reprint_compression_penalty:money(compression),value_concentration_risk:money(concentration),collector_score:money(collector),opportunity_score:money(opportunity),confidence:Number(confidence.toFixed(3)),naive_comparable_ev:money(naive),compression_adjusted_ev:money(adjusted),settled_ev:money(adjusted),acquisition_cost:money(acquisition),expected_net_after_fees:money(net),expected_roi_pct:money(roi),recommendation:rec,thesis:`${finish} ${region}: ${rec.replaceAll('_',' ')}. Compression-adjusted card EV ${money(adjusted)} vs ${money(acquisition)} acquisition; collector ${money(collector)}, opportunity ${money(opportunity)}.`,what_changes_grade:'Launch sell-through by storefront, confirmed allocation evidence, realized treatment premiums, and actual TCG sales.',model_version:'secret-lair-v1.1-scored',score_components:{fee_rate:.25,coverage,priced_coverage:pricedCoverage,evidence_rows:evidence.length,supply_semantics:'global_supply_regional_allocation',economics_floor:economicsFloor,post_fee_roi_pct:money(roi),compression_already_in_ev:true}}]});
    const evaluation=inserted?.[0];if(!evaluation?.evaluation_id)throw Error('Unable to save scored evaluation');
    const cardRows=resolved.map((v:any)=>({user_id:u.id,evaluation_id:evaluation.evaluation_id,release_id:drop.release_id,drop_id:drop.drop_id,drop_card_id:v.card.drop_card_id,card_name:v.card.card_name,oracle_id:v.oracle,finish,resolved_printing_count:v.printing_count,premium_printing_count:v.premium_count,normal_market_floor:v.normal_floor==null?null:money(v.normal_floor),normal_market_median:v.normal_median==null?null:money(v.normal_median),liquid_premium_comparable:v.liquid_comparable==null?null:money(v.liquid_comparable),premium_sales_90d:money(v.premium_sales),total_sales_90d:money(v.total_sales),premium_competition_score:money(v.competition),reprint_compression_penalty:money(v.compression),bling_gap:money(v.bling),naive_comparable_value:money(v.naive),compression_adjusted_value:money(v.adjusted),liquidity_score:money(v.liquidity),coverage_confidence:Number(v.coverage.toFixed(3)),comparable_metadata:v.metadata}));
    if(cardRows.length)await rest(t,'secret_lair_card_valuations',{method:'POST',prefer:'return=minimal',body:cardRows});
    return J({ok:true,scored:true,evaluation_id:evaluation.evaluation_id,drop_name:drop.drop_name,region,finish,recommendation:rec,collector_score:money(collector),opportunity_score:money(opportunity),naive_ev:money(naive),compression_adjusted_ev:money(adjusted),expected_net_after_fees:money(net),expected_roi_pct:money(roi),confidence:Number(confidence.toFixed(3)),coverage,economics_floor:economicsFloor,cards:cardRows});
  }catch(e){return J({error:(e as Error).message},502)}
});