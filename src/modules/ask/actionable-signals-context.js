import store from '../../state/store.js';

// Merge actionable/emerging Signals context into the existing fast Ask payload.
(() => {
  if(window.__collectishAskActionableSignalsContextInstalled)return;
  window.__collectishAskActionableSignalsContextInstalled=true;

  const num=v=>v==null||v===''?null:Number(v);
  const lower=v=>String(v||'').trim().toLowerCase();
  const TREATMENT_SUFFIX=/\s*\((?:borderless|extended art|showcase|retro frame|retro|etched|surge foil|galaxy foil|serialized|promo|buy-a-box|prerelease|commander|concept praetor|step-and-compleat|oil slick|poster|raised foil|textured foil|borderless manga|anime|full art)\)\s*$/i;
  function canonicalName(v){
    let s=String(v||'').trim();
    let prev='';
    while(s&&s!==prev){prev=s;s=s.replace(TREATMENT_SUFFIX,'').trim()}
    return lower(s);
  }

  function matchActionable(body={}){
    const rows=store.get().actionableEmerging?.rows||[];
    const card=body.cardSnapshot||{};
    const sku=String(card.skuId||body.context?.sku_id||'');
    const product=String(card.productId||body.context?.product_id||'');
    const name=canonicalName(card.name||body.context?.product_name_hint);
    const exact=rows.find(r=>(sku&&String(r.sku_id||'')===sku)||(product&&String(r.product_id||'')===product));
    if(exact)return {row:exact,scope:'exact-printing'};
    const sameName=rows
      .filter(r=>name&&canonicalName(r.card_name)===name)
      .sort((a,b)=>Number(b.actionability_score||0)-Number(a.actionability_score||0))[0]||null;
    return sameName?{row:sameName,scope:'same-name'}:null;
  }

  function compact(match){
    if(!match?.row)return null;
    const r=match.row;
    return {
      source:'actionable_emerging',
      scope:match.scope,
      sourceCardName:r.card_name||null,
      sourceProductId:r.product_id||null,
      sourceSkuId:r.sku_id||null,
      sourcePrinting:r.printing||null,
      class:r.action_class||null,
      actionability:num(r.actionability_score),
      primarySignal:r.primary_signal||null,
      signalFamilies:num(r.signal_families),
      signalLabels:r.signal_labels||null,
      liquidityLabel:r.liquidity_label||null,
      liquidityScore:num(r.liquidity_score),
      directRoiPct:num(r.direct_roi_pct),
      targetRoiPct:num(r.target_roi_pct),
      marginCushionPct:num(r.margin_cushion_pct),
      baseScoutScore:num(r.base_scout_score),
      adjustedScoutScore:num(r.adjusted_scout_score),
      cheapestBuy:num(r.cheapest_buy),
      directNet:num(r.direct_net_est),
      directNetProfit:num(r.direct_net_profit),
      reason:r.action_reason||null
    };
  }

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const raw=input instanceof Request?input.url:String(input||'');
    let isFast=false;
    try{isFast=new URL(raw,location.href).pathname.endsWith('/functions/v1/ask-collectish-stream')}catch{}
    if(!isFast||input instanceof Request||!init?.body)return nativeFetch(input,init);
    try{
      const body=JSON.parse(String(init.body));
      const actionable=compact(matchActionable(body));
      if(!actionable)return nativeFetch(input,init);
      const existing=body.signalsSnapshot;
      const merged=existing&&typeof existing==='object'
        ? (existing.rollup||existing.actionable?{...existing,actionable}:{rollup:existing,actionable})
        : {rollup:null,actionable};
      return nativeFetch(input,{...init,body:JSON.stringify({...body,signalsSnapshot:merged})});
    }catch{return nativeFetch(input,init)}
  };

  window.CollectishAskActionableSignalsContext={match:matchActionable,compact,canonicalName};
})();
