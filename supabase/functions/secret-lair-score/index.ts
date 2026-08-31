import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const money=(n:number)=>Number((Number(n)||0).toFixed(2));
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:H(t)});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function weighted(pairs:any[]){let s=0,w=0;for(const [v,ww] of pairs){if(Number.isFinite(Number(v))&&Number(ww)>0){s+=clamp(Number(v))*Number(ww);w+=Number(ww)}}return w?clamp(s/w):50}
function evidenceScore(rows:any[],dims:string[],fallback=50){const picked=rows.filter(r=>dims.includes(r.claim_dimension));if(!picked.length)return fallback;let s=0,w=0;for(const r of picked){const base=r.direction==='bullish'?82:r.direction==='bearish'?18:50;const ww=Math.max(.15,Number(r.confidence)||.5);s+=base*ww;w+=ww}return clamp(s/w)}
function recommendation(s:number,c:number,conf:number){if(s>=92&&conf>=.72)return'pot_of_gold';if(s>=84)return'strong_buy';if(s>=74)return'buy';if(s>=64)return'selective_buy';if(s>=54)return'speculative';if(s<45&&c>=75)return'personal_only';if(s<45)return'pass';return'watch'}
function evScore(cost:number,net:number){if(!(cost>0)||!Number.isFinite(net))return 45;return clamp(45+((net-cost)/cost)*80)}
function median(xs:number[]){const a=xs.filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return J({error:'POST required'},405);
 const t=bearer(req);if(!t)return J({error:'Authentication required'},401);let u:any;try{u=await auth(t)}catch{return J({error:'Authentication required'},401)}
 let b:any;try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
 const dropId=String(b?.drop_id||'');const region=['US','REU','UK'].includes(String(b?.region||'').toUpperCase())?String(b.region).toUpperCase():'US';const finish=['nonfoil','foil','other'].includes(String(b?.finish||''))?String(b.finish):'nonfoil';
 if(!dropId)return J({error:'drop_id required'},400);
 try{
  const drops=await rest(t,`secret_lair_drops?select=drop_id,release_id,drop_name,nonfoil_msrp,foil_msrp,currency,wpn_nonfoil&drop_id=eq.${encodeURIComponent(dropId)}&limit=1`);const drop=drops?.[0];if(!drop)throw Error('Drop not found');
  const cards=await rest(t,`secret_lair_drop_cards?select=drop_card_id,card_name,is_token,is_bonus_card&drop_id=eq.${encodeURIComponent(dropId)}&order=created_at.asc`);
  const evidence=await rest(t,`secret_lair_evidence?select=claim_dimension,direction,confidence,evidence_class,summary&drop_id=eq.${encodeURIComponent(dropId)}&order=observed_at.desc&limit=300`).catch(()=>[]);
  const offers=await rest(t,`secret_lair_drop_offers?select=price,currency,finish,region&drop_id=eq.${encodeURIComponent(dropId)}&region=eq.${region}&finish=eq.${finish}&limit=1`).catch(()=>[]);
  const acquisition=Number(offers?.[0]?.price ?? (finish==='foil'?drop.foil_msrp:drop.nonfoil_msrp));
  const relevant=(cards||[]).filter((c:any)=>!c.is_token&&!c.is_bonus_card);const vals:any[]=[];
  for(const c of relevant){
    const exact=await rest(t,`mtgjson_cards?select=uuid,name,scryfall_oracle_id&name=eq.${encodeURIComponent(c.card_name)}&scryfall_oracle_id=not.is.null&limit=1`).catch(()=>[]);const oracle=exact?.[0]?.scryfall_oracle_id||null;
    if(!oracle){vals.push({card:c,resolved:false});continue}
    const prints=await rest(t,`mtgjson_cards?select=uuid,set_code,collector_number,release_date& scryfall_oracle_id=eq.${oracle}&limit=500`.replace('?select=uuid,set_code,collector_number,release_date& ','?select=uuid,set_code,collector_number,release_date&')).catch(()=>[]);
    const uuids=(prints||[]).map((x:any)=>x.uuid).filter(Boolean);if(!uuids.length){vals.push({card:c,resolved:false,oracle});continue}
    const inU=`(${uuids.join(',')})`;const prices=await rest(t,`tcgplayer_preferred_price_current_cache?select=uuid,finish,product_id,market_price,low_price,lowest_listing_price&uuid=in.${inU}`).catch(()=>[]);
    const skus=await rest(t,`mtgjson_tcgplayer_skus?select=sku_id,uuid,finish,condition,language&uuid=in.${inU}&condition=eq.NEAR MINT&language=eq.English`).catch(()=>[]);
    const skuIds=(skus||[]).map((x:any)=>x.sku_id).filter(Boolean);let sales:any[]=[];if(skuIds.length){const since=new Date(Date.now()-90*864e5).toISOString().slice(0,10);sales=await rest(t,`marketplace_sku_sales_buckets?select=sku_id,quantity_sold&bucket_start_date=gte.${since}&sku_id=in.(${skuIds.join(',')})`).catch(()=>[])}
    const salesBySku=new Map<string,number>();for(const x of sales||[])salesBySku.set(String(x.sku_id),Number(salesBySku.get(String(x.sku_id))||0)+Number(x.quantity_sold||0));
    const salesByUuid=new Map<string,number>();for(const s of skus||[])salesByUuid.set(String(s.uuid),Number(salesByUuid.get(String(s.uuid))||0)+Number(salesBySku.get(String(s.sku_id))||0));
    const normal=(prices||[]).filter((p:any)=>p.finish==='normal'&&Number(p.market_price)>0),target=(prices||[]).filter((p:any)=>p.finish===(finish==='foil'?'foil':'normal')&&Number(p.market_price)>0);
    const normalFloor=normal.length?Math.min(...normal.map((p:any)=>Number(p.market_price))):null;const normalMedian=median(normal.map((p:any)=>Number(p.market_price)));
    const liquid=target.filter((p:any)=>Number(salesByUuid.get(String(p.uuid))||0)>0);const comparablePool=liquid.length?liquid:target;const liquidComparable=comparablePool.length?Math.max(...comparablePool.map((p:any)=>Number(p.market_price))):null;
    const targetPremiums=target.filter((p:any)=>normalFloor&&Number(p.market_price)>=normalFloor*1.5);const competition=clamp(targetPremiums.length*12);
    const base=Number(normalFloor||normalMedian||0),comp=Number(liquidComparable||base||0),gapRatio=comp>0?clamp(((comp-base)/comp)*100):0;
    const compression=clamp(25+gapRatio*.45+competition*.25,20,92);const adjusted=comp>base?base+(comp-base)*(1-compression/100):Math.max(base,comp);
    const totalSales=[...salesByUuid.values()].reduce((a,n)=>a+n,0),targetUuids=new Set(target.map((p:any)=>String(p.uuid))),premiumSales=[...salesByUuid.entries()].filter(([id])=>targetUuids.has(id)).reduce((a,[,n])=>a+n,0);
    const liquidity=clamp(Math.log10(1+totalSales)*32);const bling=clamp(50+gapRatio*.35-competition*.18);
    vals.push({card:c,resolved:true,oracle,printing_count:uuids.length,premium_count:target.length,normal_floor:base||null,normal_median:normalMedian,liquid_comparable:liquidComparable,premium_sales:premiumSales,total_sales:totalSales,competition,compression,bling,naive:comp||base,adjusted,liquidity,coverage:prices.length?Math.min(.95,.45+.5*Math.min(1,prices.length/Math.max(1,uuids.length))):.2,metadata:{liquid_comparable_used:Boolean(liquid.length),priced_printings:prices.length,target_finish:finish}});
  }
  const resolved=vals.filter(v=>v.resolved&&Number(v.adjusted)>=0),coverage= relevant.length?resolved.length/relevant.length:0,pricedCoverage=resolved.length?resolved.filter(v=>Number(v.naive)>0).length/resolved.length:0;
  if(coverage<.70||pricedCoverage<.60)return J({ok:true,scored:false,reason:'insufficient_market_coverage',coverage,priced_coverage:pricedCoverage,cards:vals.map(v=>({card_name:v.card.card_name,resolved:v.resolved}))});
  const naive=resolved.reduce((a,v)=>a+Number(v.naive||0),0),adjusted=resolved.reduce((a,v)=>a+Number(v.adjusted||0),0),liquidityAvg=resolved.reduce((a,v)=>a+v.liquidity,0)/resolved.length;
  const top=resolved.length?Math.max(...resolved.map(v=>Number(v.adjusted||0))):0;const anchor=clamp(acquisition>0?35+(top/acquisition)*55:50),depth=clamp((resolved.filter(v=>v.total_sales>0).length/Math.max(1,resolved.length))*100);
  const cardsScore=weighted([[anchor,.45],[depth,.30],[liquidityAvg,.25]]),treatment=evidenceScore(evidence,['art','treatment','version_of_choice','premium_competition','ip_fit'],55),audience=evidenceScore(evidence,['ip_heat','cute_meme_nostalgia','merchandise'],50);
  const supply=50;const blingAvg=resolved.reduce((a,v)=>a+v.bling,0)/resolved.length;const collector=weighted([[treatment,.34],[audience,.30],[blingAvg,.22],[cardsScore,.10],[supply,.04]]);
  const net=adjusted*.75,evs=evScore(acquisition,net),compressionAvg=resolved.reduce((a,v)=>a+v.compression,0)/resolved.length,concentration=adjusted>0?clamp(top/adjusted*100):100;
  const evidenceConf=Math.min(.9,.45+Math.min(.25,(evidence?.length||0)*.015));const conf=Math.min(.9,.35+coverage*.30+pricedCoverage*.20+(evidence?.length?evidenceConf*.15:0));
  let opportunity=weighted([[cardsScore,.20],[treatment,.14],[audience,.14],[supply,.14],[evs,.22],[liquidityAvg,.16]]);opportunity=clamp((opportunity-concentration*.08-compressionAvg*.08)*(.72+.28*conf));const rec=recommendation(opportunity,collector,conf);
  const inserted=await rest(t,'secret_lair_evaluations',{method:'POST',prefer:'return=representation',body:[{release_id:drop.release_id,drop_id:drop.drop_id,evaluation_phase:'pre_sale',evaluation_status:'scored',region,finish,cards_score:money(cardsScore),treatment_score:money(treatment),audience_score:money(audience),supply_score:supply,anchor_strength:money(anchor),playable_depth:money(depth),bling_gap:money(blingAvg),premium_competition_penalty:money(resolved.reduce((a,v)=>a+v.competition,0)/resolved.length),reprint_compression_penalty:money(compressionAvg),value_concentration_risk:money(concentration),collector_score:money(collector),opportunity_score:money(opportunity),confidence:Number(conf.toFixed(3)),naive_comparable_ev:money(naive),compression_adjusted_ev:money(adjusted),settled_ev:money(adjusted),acquisition_cost:money(acquisition),expected_net_after_fees:money(net),expected_roi_pct:acquisition>0?money((net-acquisition)/acquisition*100):null,recommendation:rec,thesis:`${finish} ${region}: ${rec.replaceAll('_',' ')}. Adjusted card EV ${money(adjusted)} versus ${money(acquisition)} acquisition; collector ${money(collector)}, opportunity ${money(opportunity)}. Global supply remains unknown; regional allocation is not treated as a separate print run.`,what_changes_grade:'Launch sell-through by storefront, confirmed supply/allocation evidence, realized Secret Lair treatment premiums, and actual TCG sales.',model_version:'secret-lair-v1-scored',score_components:{fee_rate:.25,coverage,priced_coverage:pricedCoverage,evidence_rows:evidence?.length||0,supply_semantics:'global_supply_regional_allocation'}}]});
  const evaluation=inserted?.[0];if(!evaluation?.evaluation_id)throw Error('Unable to save scored evaluation');
  const cardRows=resolved.map(v=>({user_id:u.id,evaluation_id:evaluation.evaluation_id,release_id:drop.release_id,drop_id:drop.drop_id,drop_card_id:v.card.drop_card_id,card_name:v.card.card_name,oracle_id:v.oracle,finish,resolved_printing_count:v.printing_count,premium_printing_count:v.premium_count,normal_market_floor:money(v.normal_floor),normal_market_median:v.normal_median==null?null:money(v.normal_median),liquid_premium_comparable:v.liquid_comparable==null?null:money(v.liquid_comparable),premium_sales_90d:money(v.premium_sales),total_sales_90d:money(v.total_sales),premium_competition_score:money(v.competition),reprint_compression_penalty:money(v.compression),bling_gap:money(v.bling),naive_comparable_value:money(v.naive),compression_adjusted_value:money(v.adjusted),liquidity_score:money(v.liquidity),coverage_confidence:Number(v.coverage.toFixed(3)),comparable_metadata:v.metadata}));
  if(cardRows.length)await rest(t,'secret_lair_card_valuations',{method:'POST',prefer:'return=minimal',body:cardRows});
  return J({ok:true,scored:true,evaluation_id:evaluation.evaluation_id,drop_name:drop.drop_name,region,finish,recommendation:rec,collector_score:money(collector),opportunity_score:money(opportunity),naive_ev:money(naive),compression_adjusted_ev:money(adjusted),expected_net_after_fees:money(net),expected_roi_pct:acquisition>0?money((net-acquisition)/acquisition*100):null,confidence:Number(conf.toFixed(3)),coverage,cards:cardRows});
 }catch(e){return J({error:(e as Error).message},502)}
});