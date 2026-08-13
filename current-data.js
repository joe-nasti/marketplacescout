// Collectish current data layer — canonical pagination for large cloud tables
(() => {
  if(typeof rest!=="function"||window.__collectishPagedRest)return;
  const baseRest=rest;
  const PAGE_SIZE=1000;
  const MAX_ROWS=100000;
  const fullTables=new Set([
    "marketplace_scan_rows",
    "seller_orders",
    "seller_order_items",
    "seller_payments",
    "seller_payment_adjustments",
    "syp_products",
    "reimbursement_invoices",
    "ri_discrepancies"
  ]);

  const tableFrom=path=>String(path||"").split("?")[0].replace(/^\/+/,"");
  const stripPaging=path=>String(path)
    .replace(/([?&])limit=\d+(&?)/g,(m,p1,p2)=>p2?p1:"")
    .replace(/([?&])offset=\d+(&?)/g,(m,p1,p2)=>p2?p1:"")
    .replace(/[?&]$/g,"");
  const withPaging=(path,limit,offset)=>`${path}${path.includes("?")?"&":"?"}limit=${limit}&offset=${offset}`;

  async function readAll(path){
    const clean=stripPaging(path),rows=[];
    for(let offset=0;offset<MAX_ROWS;offset+=PAGE_SIZE){
      const chunk=await baseRest(withPaging(clean,PAGE_SIZE,offset));
      rows.push(...(chunk||[]));
      if(!chunk||chunk.length<PAGE_SIZE)break;
    }
    return rows;
  }

  rest=async function(path,o={}){
    const method=String(o?.method||"GET").toUpperCase();
    if(method==="GET"&&fullTables.has(tableFrom(path)))return readAll(path);
    return baseRest(path,o);
  };

  window.__collectishPagedRest={pageSize:PAGE_SIZE,maxRows:MAX_ROWS,tables:[...fullTables]};
})();
