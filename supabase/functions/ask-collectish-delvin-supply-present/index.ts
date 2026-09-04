import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const js=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const text=(v:any)=>String(v??'').trim();
const sh=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
async function parse(r:Response){const raw=await r.text();try{return raw?JSON.parse(raw):null}catch{return raw}}
async function rest(path:string,o:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:o.method||'GET',headers:{...sh(),...(o.prefer?{Prefer:o.prefer}:{})},body:o.body===undefined?undefined:JSON.stringify(o.body)}),d:any=await parse(r);if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function fn(name:string,body:any){const r=await fetch(`${U}/functions/v1/${name}`,{method:'POST',headers:sh(),body:JSON.stringify(body)}),d:any=await parse(r);if(!r.ok)throw Error(d?.error||`${name} ${r.status}`);return d}
async function rpc(name:string,body:any){return rest(`rpc/${name}`,{method:'POST',body})}
function alias(q:string){for(const p of[/^how\s+deep\s+is\s+(?:the\s+)?market\s+(?:on|for|of)\s+(.+?)(?:[?.!,]|$)/i,/^(?:what(?:'s| is)\s+)?(?:the\s+)?market\s+depth\s+(?:on|for|of)\s+(.+?)(?:[?.!,]|$)/i,/^how(?:'s| is)\s+(?:the\s+)?(?:stock|supply|inventory|liquidity|depth)\s+(?:on|for|of)\s+(.+?)(?:[?.!,]|$)/i,/^(?:what(?:'s| is)|show(?: me)?|give me)\s+(?:the\s+)?(?:stock|supply|inventory|liquidity|depth)\s+(?:on|for|of)\s+(.+?)(?:[?.!,]|$)/i,/\b(?:stock|supply|inventory|liquidity|market\s+depth)\s+(?:on|for|of)\s+(.+?)(?:[?.!,]|$)/i]){const m=text(q).match(p);if(m?.[1])return m[1].trim()}return''}
const nfmt=(v:any)=>Number(v||0).toLocaleString('en-US');
const pct=(v:any)=>Number.isFinite(Number(v))?`${Number(v).toFixed(1)}%`:'—';
const ageMin=(v:any)=>{const t=Date.parse(text(v));return Number.isFinite(t)?Math.max(0,(Date.now()-t)/60000):null};
function finish(v:any){const s=text(v).toUpperCase();return s.includes('FOIL')&&!s.includes('NON FOIL')?'FOIL':'NON FOIL'}
function labelFor(productId:any,finishScope:any,targets:any[]){const x=(targets||[]).find((r:any)=>text(r.product_id)===text(productId)&&finish(r.printing)===finishScope)||(targets||[]).find((r:any)=>text(r.product_id)===text(productId));return [x?.set_code,x?.collector_number?`#${x.collector_number}`:null,finishScope==='FOIL'?'foil':'nonfoil'].filter(Boolean).join(' ')||`${productId} ${text(finishScope).toLowerCase()}`}
function classificationSummary(v:any){const s=text(v).toUpperCase();if(s==='DEEP')return'Plenty available across the measured NM/LP family.';if(s==='MODERATE')return'Supply looks healthy overall, with some tighter variants.';if(s==='THIN'||s==='VERY_THIN')return'The measured NM/LP family is genuinely tight.';return'Current family depth is incomplete.'}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return js({error:'POST required'},405);
  if(!S)return js({error:'Service role unavailable'},500);
  const body=await req.json().catch(()=>({})),q=text(body?.question||body?.message),name=alias(q);
  if(!name)return js({handled:false,reason:'not_supply_question'});

  const canonical=(await rpc('ask_collectish_supply_family_skus_v1',{p_card_name:name,p_scryfall_id:null}).catch(()=>[]))||[];
  const seen=new Set<string>(),targets=canonical.filter((r:any)=>/^\d+$/.test(text(r.product_id))&&/^\d+$/.test(text(r.sku_id))).filter((r:any)=>{const k=text(r.sku_id);if(seen.has(k))return false;seen.add(k);return true});
  if(!targets.length)return js({handled:true,route:'card_family_supply',response:`I found the stock question, but Collectish has no canonical English NM/LP MTGJSON family mapping for “${name}”.`,presentation:{version:3,type:'card_family_supply',title:`${name} — Stock`,summary:'Canonical MTGJSON family mapping unavailable.',badges:['UNPROVEN'],metrics:[],sections:[],footnote:'No set/SKU clarification is required unless the card name itself is ambiguous.',actions:[]},data:{card_name:name,scope:'CARD_FAMILY_NM_LP',reason:'canonical_family_not_found'}});

  let supply:any;
  try{supply=await fn('market-supply-sync',{scope:'CARD_FAMILY_NM_LP',targets:targets.map((r:any)=>({product_id:text(r.product_id),sku_id:text(r.sku_id),card_name:r.card_name,set_code:r.set_code,collector_number:r.collector_number,printing:r.printing,condition:r.condition,language:'ENGLISH',scryfall_id:r.scryfall_id})),max_pages:40})}
  catch(e){return js({handled:true,route:'card_family_supply',response:`${targets[0]?.card_name||name} resolved to ${targets.length} English NM/LP SKUs, but the market-depth refresh failed. Try again shortly.`,presentation:{version:3,type:'card_family_supply',title:`${targets[0]?.card_name||name} — Stock`,summary:'Card family resolved; market-depth refresh failed.',badges:['REFRESH FAILED'],metrics:[],sections:[],footnote:`Canonical MTGJSON family: ${targets.length} English NM/LP SKUs.`,actions:[]},data:{card_name:targets[0]?.card_name||name,scope:'CARD_FAMILY_NM_LP',reason:'family_resolved_market_sync_failed',error:String((e as Error)?.message||e)}})}

  const skus=targets.map((x:any)=>text(x.sku_id));
  const [concentration,trend]=await Promise.all([rpc('ask_collectish_family_supply_concentration_v1',{p_sku_ids:skus}).catch(()=>null),rpc('ask_collectish_family_supply_trend_v1',{p_sku_ids:skus,p_days:90}).catch(()=>null)]);
  const total=supply?.combined||{},sources=supply?.source_depth||{},ck=sources?.cardkingdom_retail||{},mp=sources?.manapool_retail||{};
  const cardName=text(targets[0]?.card_name||name),classification=text(supply?.global_supply_classification||supply?.classification||'UNPROVEN').toUpperCase(),tcgClass=text(supply?.tcgplayer_supply_classification||total?.classification||'UNPROVEN').toUpperCase(),summaryBase=classificationSummary(classification);
  const tcg=Number(total.unit_count||0),listings=Number(total.listing_count||0),direct=Number(total.direct_unit_count||0),nonDirect=Number(total.non_direct_unit_count||0),mpQty=Number(mp.quantity??total.manapool_retail_quantity??0);
  const mpCovered=Number(mp.fresh_sku_count??mp.covered_sku_count??0),mpExpected=Number(mp.expected_sku_count??targets.length),mpComplete=mpExpected>0&&mpCovered>=mpExpected,mpLabel=mpComplete?'ManaPool NM/LP':'ManaPool observed';
  const rows=Array.isArray(concentration?.printing_rows)?concentration.printing_rows:[],deep=concentration?.deepest_printing||null,tight=concentration?.tightest_printing||null,top1=Number(concentration?.top1_supply_share_pct),top3=Number(concentration?.top3_supply_share_pct),conc=text(concentration?.concentration_classification||'');
  const deepLabel=deep?labelFor(deep.product_id,deep.finish,targets):null,tightLabel=tight?labelFor(tight.product_id,tight.finish,targets):null;
  const summaryParts=[`${classification} · ${summaryBase}`];if(Number.isFinite(top1)&&deepLabel)summaryParts.push(`${pct(top1)} of TCG supply is in ${deepLabel}`);if(tight&&tightLabel&&['THIN','VERY_THIN'].includes(text(tight.supply_classification)))summaryParts.push(`${tightLabel} is ${text(tight.supply_classification)} (${nfmt(tight.unit_count)} units)`);const summary=summaryParts.join(' · ');
  const trendLabel=text(trend?.trend||'UNPROVEN'),trendPoints=Number(trend?.complete_observation_points||0),trendText=trendLabel==='UNPROVEN'?`No historical direction yet — ${trendPoints} complete family observation${trendPoints===1?'':'s'}.`:`${nfmt(trend?.first_units)} → ${nfmt(trend?.last_units)} TCG units (${Number(trend?.unit_change_pct)>=0?'+':''}${Number(trend?.unit_change_pct||0).toFixed(1)}%) across ${nfmt(trend?.observed_span_days)} observed days · ${trendLabel.replaceAll('_',' ')}`;
  const variantRows=rows.slice(0,10).map((r:any)=>({title:labelFor(r.product_id,r.finish,targets),subtitle:`${text(r.supply_classification).replaceAll('_',' ')} · ${pct(r.supply_share_pct)} of family TCG supply`,badges:[text(r.supply_classification)],metrics:[{label:'TCG',value:r.unit_count,display:nfmt(r.unit_count)},{label:'Listings',value:r.listing_count,display:nfmt(r.listing_count)},{label:'Direct',value:r.direct_unit_count,display:nfmt(r.direct_unit_count)}],raw:r}));
  const ckStatus=text(ck.freshness_status||'MISSING'),ckAvailable=ck.available===true,ckAge=ck.observed_at?ageMin(ck.observed_at):null;
  const mpCoverage=`${mpCovered}/${mpExpected} SKUs${mpComplete?'':' · partial'}`;
  const ckLine=ckAvailable?`Card Kingdom NM/EX: **${nfmt(ck.quantity)}** copies (${ckStatus.toLowerCase()})`:'Card Kingdom NM/EX: **unavailable**';
  const response=`**${cardName} — Stock**\n**${classification}** · ${summaryBase}\n\nTCGplayer (${tcgClass}): **${nfmt(tcg)}** units across **${nfmt(listings)}** listings\n↳ Direct **${nfmt(direct)}** · Non-Direct **${nfmt(nonDirect)}**\n${mpLabel}: **${nfmt(mpQty)}** copies (${mpCoverage})\n${ckLine}\n\n${deepLabel&&Number.isFinite(top1)?`Supply concentration: **${pct(top1)}** in ${deepLabel}; top 3 = **${pct(top3)}**.\n`:''}${tight&&tightLabel?`Tightest printing: **${tightLabel}** — ${text(tight.supply_classification)} (${nfmt(tight.unit_count)} units).\n`:''}History: ${trendText}`;
  const sections:any[]=[];
  if(concentration?.available)sections.push({heading:'Supply concentration',kind:'text',text:`${conc.replaceAll('_',' ')} · largest printing ${pct(top1)} · top 3 ${pct(top3)}${Number.isFinite(Number(concentration?.hhi))?` · HHI ${nfmt(concentration.hhi)}`:''}. A scarce premium printing does not make the whole card family thin.`});
  if(variantRows.length)sections.push({heading:'Printing depth',kind:'ranked_rows',rows:variantRows});
  sections.push({heading:'Observed trend',kind:'text',text:trendText});
  const cov=supply?.coverage||{},cache=supply?.cache||{},foot=[`English NM/LP Oracle-family scope`,`canonical MTGJSON SKU map`,`${cov.complete_sku_count||0}/${cov.target_sku_count||targets.length} TCG SKUs complete`,`TCGplayer/ManaPool cache 30m`,`ManaPool ${mpCoverage}`,`CK mapping ${ck.mapped_identity_count||0}/${ck.expected_identity_count||0}`];if(ckAge!=null)foot.push(`CK ${Math.round(ckAge/60)}h old`);if(Number(cache?.tcgplayer?.hits||0)||Number(cache?.manapool?.hits||0))foot.push(`cache reused ${cache?.tcgplayer?.hits||0} TCG / ${cache?.manapool?.hits||0} MP`);
  const presentation={version:4,type:'card_family_supply',title:`${cardName} — Stock`,summary,badges:[classification,...(conc?[conc.replaceAll('_',' ')]:[])],metrics:[{label:'TCGplayer',value:tcg,display:`${nfmt(tcg)} units · ${nfmt(listings)} listings`},{label:'Direct',value:direct,display:nfmt(direct)},{label:'Non-Direct',value:nonDirect,display:nfmt(nonDirect)},{label:mpLabel,value:mpQty,display:`${nfmt(mpQty)} · ${mpCoverage}`},{label:'CK NM/EX',value:Number(ck.quantity||0),display:ckAvailable?`${nfmt(ck.quantity)} · ${ckStatus.toLowerCase()}`:'unavailable'}],sections,footnote:foot.join(' · '),actions:[]};
  return js({handled:true,route:'card_family_supply',response,presentation,data:{card_name:cardName,scope:'CARD_FAMILY_NM_LP',canonical_target_count:targets.length,market_supply:supply,concentration,trend,sku_ids:skus}});
});
