import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const token=(req:Request)=>{const h=req.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const headers=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});

async function rpc(t:string,name:string,args:any={}){
  const r=await fetch(`${U}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(t),body:JSON.stringify(args)});
  const text=await r.text();let data:any;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw Error(data?.message||`${name} failed (${r.status})`);
  return data;
}

function toolNames(upstream:any){return new Set((upstream?.tools||[]).filter((x:any)=>x?.ok!==false).map((x:any)=>String(x?.name||'').replace(':auto_context','')))}
function exactAction(upstream:any,type:string){return (upstream?.ui_actions||[]).find((a:any)=>a?.type===type)||null}
function actionBar(screen:string,row:any){
  if(screen==='scout'&&row?.product_id)return [{type:'open_card',label:'Open in Scout',product_id:String(row.product_id),primary:true},{type:'ask',label:'Explain risks',prompt:'What are the biggest risks for this opportunity?'}];
  if(screen==='syp'&&row?.sku_id)return [{type:'open_syp_item',label:'Open SYP item',sku_id:String(row.sku_id),primary:true},{type:'ask',label:'Show history',prompt:'Show the history for this exact SYP SKU.'}];
  if(screen==='seller'&&row?.order_number)return [{type:'open_order',label:'Open order',order_id:String(row.order_number),primary:true}];
  return [];
}
function normalizeScout(row:any){return {sku_id:row?.sku_id??null,product_id:row?.product_id??null,product_name:row?.product_name??null,grade:row?.promoted_grade??null,score:row?.promoted_score??null,market_price:row?.sku_market_price??null,direct_available:row?.direct_available??null,edhrec_rank:row?.edhrec_rank??null,set_name:row?.set_name??null,condition:row?.condition??null,printing:row?.printing??null,language:row?.language??null}}

async function buildSurfaces(t:string,body:any,upstream:any){
  const surfaces:any[]=[];const ctx=body?.context||{};const screen=String(ctx?.screen||upstream?.context_screen||'').toLowerCase();const tools=toolNames(upstream);
  try{
    if(screen==='scout'&&(ctx.product_id||ctx.sku_id)){
      const row=await rpc(t,'ask_collectish_get_scout_card',{p_product_id:ctx.product_id??null,p_sku_id:ctx.sku_id??null});const card=Array.isArray(row)?row[0]:row;
      if(card)surfaces.push({type:'opportunity_card',domain:'scout',title:'Scout opportunity',item:normalizeScout(card),actions:actionBar('scout',card)});
    }else if(screen==='syp'&&ctx.sku_id){
      const row=await rpc(t,'ask_collectish_get_syp_offer',{p_sku_id:String(ctx.sku_id)});const item=Array.isArray(row)?row[0]:row;
      if(item)surfaces.push({type:'entity_card',domain:'syp',title:'SYP offer',item,actions:actionBar('syp',item)});
    }else if(screen==='seller'&&ctx.order_id){
      const rows=await rpc(t,'ask_collectish_search_orders',{p_filters:{order_number:String(ctx.order_id),limit:1}});const item=rows?.results?.[0]||rows?.[0]||null;
      if(item)surfaces.push({type:'entity_card',domain:'seller',title:'Seller order',item,actions:actionBar('seller',item)});
    }else if(screen==='inventory'&&ctx.sku_id){
      const rows=await rpc(t,'ask_collectish_get_inventory_aging',{p_filters:{sku_id:String(ctx.sku_id),limit:1}});const item=rows?.results?.[0]||rows?.[0]||null;
      if(item)surfaces.push({type:'entity_card',domain:'inventory',title:'Inventory item',item,actions:[]});
    }
  }catch{}

  const filtered=exactAction(upstream,'apply_filters');
  if(filtered?.screen==='scout'&&tools.has('search_scout')){
    try{const data=await rpc(t,'ask_collectish_search_scout',{p_filters:{...(filtered.filters||{}),limit:8}});const rows=(data?.results||data||[]).slice(0,8);if(rows.length>1)surfaces.push({type:'opportunity_carousel',domain:'scout',title:'Scout opportunities',items:rows.map(normalizeScout),coverage_note:data?.coverage_note||data?.coverage?.coverage_note||null,actions:[{type:'navigate',screen:'scout',label:'Open Scout',primary:true}]})}catch{}
  }else if(filtered?.screen==='syp'&&tools.has('search_syp')){
    try{const data=await rpc(t,'ask_collectish_search_syp',{p_filters:{...(filtered.filters||{}),limit:8}});const rows=(data?.results||data||[]).slice(0,8);if(rows.length)surfaces.push({type:'result_list',domain:'syp',title:'SYP results',items:rows,coverage_note:data?.coverage_note||null})}catch{}
  }else if(filtered?.screen==='seller'&&tools.has('search_orders')){
    try{const data=await rpc(t,'ask_collectish_search_orders',{p_filters:{...(filtered.filters||{}),limit:8}});const rows=(data?.results||data||[]).slice(0,8);if(rows.length)surfaces.push({type:'result_list',domain:'seller',title:'Seller results',items:rows,coverage_note:data?.coverage_note||null})}catch{}
  }else if(filtered?.screen==='inventory'&&tools.has('get_inventory_aging')){
    try{const data=await rpc(t,'ask_collectish_get_inventory_aging',{p_filters:{...(filtered.filters||{}),limit:8}});const rows=(data?.results||data||[]).slice(0,8);if(rows.length)surfaces.push({type:'result_list',domain:'inventory',title:'Inventory results',items:rows,coverage_note:data?.coverage_note||null})}catch{}
  }
  return surfaces.slice(0,3);
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return json({error:'POST required'},405);
  const t=token(req);if(!t)return json({error:'Authentication required'},401);
  let body:any;try{body=await req.json()}catch{return json({error:'Invalid JSON'},400)}
  const r=await fetch(`${U}/functions/v1/ask-collectish`,{method:'POST',headers:headers(t),body:JSON.stringify(body)});
  const text=await r.text();let upstream:any;try{upstream=text?JSON.parse(text):{}}catch{return new Response(text,{status:r.status,headers:{...C,'Content-Type':r.headers.get('content-type')||'text/plain','Cache-Control':'no-store'}})}
  if(!r.ok)return json(upstream,r.status);
  if(String(body?.action||'chat')!=='chat')return json(upstream,r.status);
  const surfaces=await buildSurfaces(t,body,upstream);
  return json({...upstream,surface_schema:'collectish.ask.surface.v1',surfaces},r.status);
});
