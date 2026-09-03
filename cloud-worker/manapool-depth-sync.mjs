// ManaPool supply depth is intentionally exact-card/on-demand only.
//
// This legacy cloud-worker entrypoint used to select the top N executable
// Card Kingdom buylist targets and fan out across them. That behavior is
// prohibited: a Delvin/Ask supply lookup must resolve one exact TCGplayer SKU
// first and probe only that printing.
//
// Keep this file as a compatibility launcher for any existing workflow/manual
// invocation, but make broad scans impossible. The actual collector lives in
// the `manapool-supply-sync` Edge Function.

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_ROLE=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const PRODUCT_ID=String(process.env.MANAPOOL_TARGET_PRODUCT_ID||'').trim();
const SKU_ID=String(process.env.MANAPOOL_TARGET_SKU_ID||'').trim();
const THRESHOLD_PRICE=String(process.env.MANAPOOL_THRESHOLD_PRICE||'').trim();

if(!SUPABASE_URL||!SERVICE_ROLE){
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}
if(!/^\d+$/.test(PRODUCT_ID)||!/^\d+$/.test(SKU_ID)){
  throw new Error(
    'Exact ManaPool target required. Batch ManaPool scans are disabled. ' +
    'Set MANAPOOL_TARGET_PRODUCT_ID and MANAPOOL_TARGET_SKU_ID.'
  );
}

const body={product_id:PRODUCT_ID,sku_id:SKU_ID};
if(THRESHOLD_PRICE&&Number.isFinite(Number(THRESHOLD_PRICE))&&Number(THRESHOLD_PRICE)>0){
  body.threshold_price=Number(THRESHOLD_PRICE);
}

const response=await fetch(`${SUPABASE_URL}/functions/v1/manapool-supply-sync`,{
  method:'POST',
  headers:{
    'Content-Type':'application/json',
    apikey:SERVICE_ROLE,
    Authorization:`Bearer ${SERVICE_ROLE}`
  },
  body:JSON.stringify(body)
});
const raw=await response.text();
let result;
try{result=raw?JSON.parse(raw):null}catch{result={raw}}
if(!response.ok){
  throw new Error(`manapool-supply-sync ${response.status}: ${String(result?.error||raw).slice(0,500)}`);
}
console.log(JSON.stringify({ok:true,target:{product_id:PRODUCT_ID,sku_id:SKU_ID},result}));
