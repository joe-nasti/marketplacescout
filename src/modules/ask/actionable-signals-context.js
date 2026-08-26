import store from '../../state/store.js';

// Merge actionable/emerging Signals context into the existing fast Ask payload.
(() => {
  if(window.__collectishAskActionableSignalsContextInstalled)return;
  window.__collectishAskActionableSignalsContextInstalled=true;

  const num=v=>v==null||v===''?null:Number(v);
  const lower=v=>String(v||'').trim().toLowerCase();

  function matchActionable(body={}){
    const rows=store.get().actionableEmerging?.rows||[];
    const card=body.cardSnapshot||{};
    const sku=String(card.skuId||body.context?.sku_id||'');
    const product=String(card.productId||body.context?.product_id||'');
    const name=lower(card.name||body.context?.product_name_hint);
    return rows.find(r=>(sku&&String(r.sku_id||'')===sku)||(product&&String(r.product_id||'')===product)||(name&&lower(r.card_name)===name))||null;
  }

  function compact(r){
    if(!r)return null;
    return {
      source:'actionable_emerging',
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

  window.CollectishAskActionableSignalsContext={match:matchActionable,compact};
})();
