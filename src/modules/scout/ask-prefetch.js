import store from '../../state/store.js';
import { ASK_PREFETCH_CONFIG } from '../../core/config.js';
import { prefetchAskContext, abortAskPrefetch } from '../ask/prefetch.js';

const str=v=>v==null?'':String(v);
const num=v=>v==null||v===''?null:Number(v);

function rowFor(detail={}){
  const sku=str(detail.sku_id??detail.sku);
  const rows=store.get().scout?.rows||[];
  return rows.find(r=>str(r.sku_id)===sku)||detail;
}
function compact(row={}){
  return {
    name:row.name??row.product_name??row.card_name??row.product_name_hint??null,
    low:num(row.low??row.tcg_low??row.tcg_low_price??row.sku_low_price),
    direct:num(row.direct??row.directLow??row.direct_low??row.tcg_direct_low??row.direct_low_price),
    spread:num(row.spread??row.directMultiplier??row.direct_multiplier),
    ckBuylist:num(row.ckBuylist??row.ck_buylist??row.cardkingdom_buylist??row.card_kingdom_buylist)
  };
}

export async function prefetchAskCardContext(detail={}){
  if(!ASK_PREFETCH_CONFIG.enabled)return {skipped:'disabled'};
  const row=rowFor(detail),snapshot=compact(row),identity=row.product_id??row.sku_id??snapshot.name;
  return prefetchAskContext({
    scope:'scout',
    identity,
    snapshot,
    context:{screen:'scout',product_id:row.product_id??null,sku_id:row.sku_id??null}
  });
}

export function abortAskCardPrefetch(){abortAskPrefetch()}

window.CollectishScoutAskPrefetch={prefetch:prefetchAskCardContext,abort:abortAskCardPrefetch,config:ASK_PREFETCH_CONFIG};
