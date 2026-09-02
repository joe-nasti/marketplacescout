const MINUTE=60*1000;
const HOUR=60*MINUTE;
const DAY=24*HOUR;

const freshRouteRead={staleWhileRevalidate:false,fallbackToStaleOnError:true};

export const ROUTE_DATA_CONTRACTS={
  sealed:[
    {key:'sealed.rows',role:'firstUse',maxStale:7*DAY},
    {key:'sealed.catalogProducts',role:'firstUse',maxStale:30*DAY},
    {key:'sealed.setTypes',role:'firstUse',maxStale:30*DAY}
  ],
  signals:[
    {
      key:'signals.feed',
      role:'firstUse',
      path:'market_intel_items?select=intel_id,source_type,source_name,source_url,title,author,summary,claim_type,signal_stage,direction,confidence,observed_at,published_at,created_at,market_intel_entities(entity_type,entity_name,scryfall_id,product_id,set_code,confidence),market_intel_card_mentions(card_name,scryfall_id)&order=observed_at.desc&limit=200',
      ttl:MINUTE,
      maxStale:DAY,
      ...freshRouteRead
    },
    {
      key:'signals.salesResponse',
      role:'usefulSoon',
      path:'marketplace_signal_card_sales_response?select=card_name,evidence_status,evidence_level,time_to_3_transactions_days,post_signal_transactions_to_date,transaction_velocity_lift_30d_pct,coverage_status,coverage_pct&limit=500',
      ttl:5*MINUTE,
      maxStale:DAY,
      ...freshRouteRead
    }
  ],
  seller:[
    {
      key:'seller.dashboardSummary',
      role:'firstUse',
      path:'seller_dashboard_summary?select=*&limit=1',
      ttl:2*MINUTE,
      maxStale:12*HOUR,
      ...freshRouteRead
    },
    {
      key:'seller.recentOrders',
      role:'firstUse',
      path:'seller_orders?select=order_number,order_date,order_status,order_channel,order_fulfillment,buyer_name,gross_amount,fee_amount,direct_fee_amount,net_amount,refund_total,review_rating,has_details&order=order_date.desc&limit=40',
      ttl:2*MINUTE,
      maxStale:12*HOUR,
      ...freshRouteRead
    },
    {
      key:'seller.refundReasons',
      role:'firstUse',
      path:'seller_refund_reason_summary?select=reason,refund_count,refund_amount,last_refund_at&order=refund_amount.desc&limit=10',
      ttl:5*MINUTE,
      maxStale:DAY,
      ...freshRouteRead
    },
    {
      key:'seller.topProducts',
      role:'usefulSoon',
      path:'seller_product_summary?select=product_name,sku_id,product_id,order_count,units_sold,revenue,last_sold_at&order=revenue.desc&limit=12',
      ttl:5*MINUTE,
      maxStale:DAY,
      ...freshRouteRead
    }
  ],
  syp:[
    {
      key:'syp.dashboardStats',
      role:'firstUse',
      method:'POST',
      path:'rpc/syp_dashboard_stats',
      body:{},
      ttl:2*MINUTE,
      maxStale:12*HOUR,
      ...freshRouteRead
    },
    {
      key:'syp.filterOptions',
      role:'firstUse',
      method:'POST',
      path:'rpc/syp_filter_options_rpc',
      body:{},
      ttl:HOUR,
      maxStale:7*DAY,
      ...freshRouteRead
    },
    {
      key:'syp.eligibleFirstPage',
      role:'firstUse',
      path:'syp_products?select=tcgplayer_id,product_name,set_name,number,condition,market_price,current_max_quantity,first_seen,last_seen,is_currently_eligible&is_currently_eligible=eq.true&order=last_seen.desc&limit=100&offset=0',
      ttl:2*MINUTE,
      maxStale:12*HOUR,
      ...freshRouteRead
    }
  ]
};

const stableBody=value=>{
  if(value==null)return '';
  if(Array.isArray(value))return `[${value.map(stableBody).join(',')}]`;
  if(typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableBody(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const requestSignature=(method,path,body)=>`${String(method||'GET').toUpperCase()} ${String(path||'')} ${stableBody(body)}`;
const requestContracts=new Map(
  Object.values(ROUTE_DATA_CONTRACTS)
    .flat()
    .filter(spec=>spec.path)
    .map(spec=>[requestSignature(spec.method||'GET',spec.path,spec.body),spec])
);

export function resourceContractForRequest(path,options={}){
  return requestContracts.get(requestSignature(options.method||'GET',path,options.body))||null;
}
export function resourceContractForPath(path){return resourceContractForRequest(path,{method:'GET'})}

export function primeSpecsForRoute(route,{roles=['firstUse','usefulSoon']}={}){
  const allowed=new Set(roles);
  return (ROUTE_DATA_CONTRACTS[route]||[])
    .filter(spec=>allowed.has(spec.role))
    .map(({key,maxStale})=>({key,scope:'user',maxStale}));
}

export function routeDataContract(route){return (ROUTE_DATA_CONTRACTS[route]||[]).map(spec=>({...spec}))}

window.CollectishRouteDataContracts={get:routeDataContract,forRequest:resourceContractForRequest,forPath:resourceContractForPath,primeSpecs:primeSpecsForRoute};
