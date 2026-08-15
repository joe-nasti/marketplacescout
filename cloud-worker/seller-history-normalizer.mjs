// Normalizers for the private authenticated Seller Portal responses used by the
// Seller History extension. This module does not call TCGplayer; it only turns
// completed Android read-only probe payloads into rows for Supabase.

const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);
const text=v=>v==null?'':String(v);
const nullableText=v=>v==null?null:String(v);
const num=v=>v==null||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const iso=v=>{
  if(!v)return null;
  const d=new Date(v);
  return Number.isFinite(d.getTime())?d.toISOString():null;
};

export function validateOrderSearchResponse(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return {ok:false,error:'Order search probe body is not an object'};
  if(!Array.isArray(body.orders))return {ok:false,error:'Order search response is missing orders[]'};
  const total=Number(body.totalOrders);
  if(!Number.isFinite(total)||total<0)return {ok:false,error:'Order search response is missing a valid totalOrders'};
  return {ok:true,totalOrders:total,orders:body.orders};
}

export function normalizeSummaryOrder(userId,order,collectedAt=new Date().toISOString()){
  const orderNumber=text(order?.orderNumber).trim();
  if(!orderNumber)return null;
  // Keep this deliberately summary-only. Detailed financial/refund/review fields
  // are omitted so an overlap summary upsert cannot erase a previously enriched
  // detail row.
  return {
    user_id:userId,
    order_number:orderNumber,
    order_date:iso(order?.orderDate||order?.createdAt),
    order_status:nullableText(order?.orderStatus||order?.status),
    order_channel:nullableText(order?.orderChannel),
    order_fulfillment:nullableText(order?.orderFulfillment),
    buyer_name:nullableText(order?.buyerName),
    shipping_type:nullableText(order?.shippingType),
    collected_at:collectedAt
  };
}

export function normalizeOrderDetail(userId,detail,collectedAt=new Date().toISOString()){
  if(!detail||typeof detail!=='object'||Array.isArray(detail))throw new Error('Order detail probe body is not an object');
  const orderNumber=text(detail.orderNumber).trim();
  if(!orderNumber)throw new Error('Order detail response is missing orderNumber');

  const transaction=detail.transaction||{};
  const feedback=detail.feedback||null;
  const refunds=Array.isArray(detail.refunds)?detail.refunds:[];
  const products=Array.isArray(detail.products)?detail.products:[];
  const taxes=Array.isArray(transaction.taxes)?transaction.taxes:[];
  const refundTotal=refunds.reduce((sum,r)=>sum+(num(r?.amount)||0),0);
  const sourceUpdatedAt=iso(detail.updatedAt||detail.modifiedAt||detail.lastUpdatedAt);
  const orderDate=iso(detail.orderDate||detail.createdAt);

  const order={
    user_id:userId,
    order_number:orderNumber,
    order_date:orderDate,
    created_at_source:iso(detail.createdAt),
    order_status:nullableText(detail.status||detail.orderStatus),
    order_channel:nullableText(detail.orderChannel),
    order_fulfillment:nullableText(detail.orderFulfillment),
    buyer_name:nullableText(detail.buyerName),
    payment_type:nullableText(detail.paymentType),
    shipping_type:nullableText(detail.shippingType),
    estimated_delivery_date:iso(detail.estimatedDeliveryDate),
    product_amount:num(transaction.productAmount),
    shipping_amount:num(transaction.shippingAmount),
    gross_amount:num(transaction.grossAmount),
    fee_amount:num(transaction.feeAmount),
    direct_fee_amount:num(transaction.directFeeAmount),
    net_amount:num(transaction.netAmount),
    tax_amount:num(taxes.find(t=>t?.code==='Total')?.amount)||0,
    refund_total:refundTotal,
    refund_status:nullableText(detail.refundStatus),
    review_rating:feedback?num(feedback.rating):null,
    review_text:feedback?text(feedback.text):'',
    review_created_at:feedback?iso(feedback.createdAt):null,
    destination_state:nullableText(detail.shippingAddress?.territory),
    destination_country:nullableText(detail.shippingAddress?.country),
    tracking_status:nullableText(Array.isArray(detail.trackingNumbers)?detail.trackingNumbers[0]?.status:null),
    has_details:true,
    detailed_at:collectedAt,
    details_needs_refresh:false,
    source_updated_at:sourceUpdatedAt,
    collected_at:collectedAt,
    raw_json:detail
  };

  const items=products.map((product,i)=>({
    user_id:userId,
    row_id:`${orderNumber}:${product?.skuId||product?.productId||i}`,
    order_number:orderNumber,
    order_date:orderDate,
    order_fulfillment:nullableText(detail.orderFulfillment),
    product_name:text(product?.name),
    product_id:text(product?.productId),
    sku_id:text(product?.skuId),
    unit_price:num(product?.unitPrice)||0,
    listing_price:num(product?.listingPrice),
    extended_price:num(product?.extendedPrice)||0,
    quantity:num(product?.quantity)||0,
    source_updated_at:sourceUpdatedAt,
    collected_at:collectedAt,
    raw_json:product
  }));

  const refundRows=refunds.map((refund,i)=>({
    user_id:userId,
    refund_id:`${orderNumber}:${refund?.createdAt||i}:${i}`,
    order_number:orderNumber,
    order_date:orderDate,
    order_fulfillment:nullableText(detail.orderFulfillment),
    buyer_name:nullableText(detail.buyerName),
    created_at_source:iso(refund?.createdAt),
    type:nullableText(refund?.type),
    amount:num(refund?.amount)||0,
    shipping_amount:num(refund?.shippingAmount)||0,
    reason:nullableText(refund?.reason),
    reason_text:nullableText(refund?.reasonText),
    origin:nullableText(refund?.origin),
    products_json:Array.isArray(refund?.products)?refund.products:[],
    source_updated_at:sourceUpdatedAt,
    collected_at:collectedAt,
    raw_json:refund
  }));

  const review=feedback?{
    user_id:userId,
    order_number:orderNumber,
    order_date:orderDate,
    order_fulfillment:nullableText(detail.orderFulfillment),
    buyer_name:nullableText(detail.buyerName),
    rating:num(feedback.rating)||0,
    review_text:text(feedback.text),
    created_at_source:iso(feedback.createdAt),
    source_updated_at:sourceUpdatedAt,
    collected_at:collectedAt,
    raw_json:feedback
  }:null;

  return {order,items,refunds:refundRows,review};
}

export function detailOrderNumberFromSearchRow(order){
  return text(order?.orderNumber).trim()||null;
}
