const MINUTE=60*1000;
const HOUR=60*MINUTE;
const DAY=24*HOUR;

export const ROUTE_DATA_CONTRACTS={
  sealed:[
    {key:'sealed.rows',role:'firstUse',maxStale:7*DAY},
    {key:'sealed.setTypes',role:'firstUse',maxStale:30*DAY}
  ],
  signals:[
    {
      key:'signals.feed',
      role:'firstUse',
      path:'market_intel_items?select=*,market_intel_entities(*),market_intel_card_mentions(*)&order=observed_at.desc&limit=200',
      ttl:MINUTE,
      maxStale:DAY
    },
    {
      key:'signals.salesResponse',
      role:'usefulSoon',
      path:'marketplace_signal_card_sales_response?select=card_name,evidence_status,evidence_level,time_to_3_transactions_days,post_signal_transactions_to_date,transaction_velocity_lift_30d_pct,coverage_status,coverage_pct&limit=500',
      ttl:5*MINUTE,
      maxStale:DAY
    }
  ],
  seller:[
    {
      key:'seller.dashboardSummary',
      role:'firstUse',
      path:'seller_dashboard_summary?select=*&limit=1',
      ttl:2*MINUTE,
      maxStale:12*HOUR
    },
    {
      key:'seller.recentOrders',
      role:'firstUse',
      path:'seller_orders?select=order_number,order_date,order_status,order_channel,order_fulfillment,buyer_name,gross_amount,fee_amount,direct_fee_amount,net_amount,refund_total,review_rating,has_details&order=order_date.desc&limit=40',
      ttl:2*MINUTE,
      maxStale:12*HOUR
    },
    {
      key:'seller.refundReasons',
      role:'firstUse',
      path:'seller_refund_reason_summary?select=reason,refund_count,refund_amount,last_refund_at&order=refund_amount.desc&limit=10',
      ttl:5*MINUTE,
      maxStale:DAY
    },
    {
      key:'seller.topProducts',
      role:'usefulSoon',
      path:'seller_product_summary?select=product_name,sku_id,product_id,order_count,units_sold,revenue,last_sold_at&order=revenue.desc&limit=12',
      ttl:5*MINUTE,
      maxStale:DAY
    }
  ]
};

const pathContracts=new Map(
  Object.values(ROUTE_DATA_CONTRACTS)
    .flat()
    .filter(spec=>spec.path)
    .map(spec=>[spec.path,spec])
);

export function resourceContractForPath(path){return pathContracts.get(String(path||''))||null}

export function primeSpecsForRoute(route,{roles=['firstUse','usefulSoon']}={}){
  const allowed=new Set(roles);
  return (ROUTE_DATA_CONTRACTS[route]||[])
    .filter(spec=>allowed.has(spec.role))
    .map(({key,maxStale})=>({key,scope:'user',maxStale}));
}

export function routeDataContract(route){return (ROUTE_DATA_CONTRACTS[route]||[]).map(spec=>({...spec}))}

window.CollectishRouteDataContracts={get:routeDataContract,forPath:resourceContractForPath,primeSpecs:primeSpecsForRoute};
