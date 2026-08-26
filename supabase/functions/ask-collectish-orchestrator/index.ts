import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const js=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const tok=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const headers=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
async function rpc(t:string,n:string,a:any={}){const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:headers(t),body:JSON.stringify(a)});const q=await r.text();let d:any;try{d=q?JSON.parse(q):null}catch{d=q}if(!r.ok)throw Error(d?.message||`${n} failed (${r.status})`);return d}
async function fn(t:string,n:string,b:any){const r=await fetch(`${U}/functions/v1/${n}`,{method:'POST',headers:headers(t),body:JSON.stringify(b)});const q=await r.text();let d:any;try{d=q?JSON.parse(q):null}catch{d=q}if(!r.ok)throw Error(d?.error||`${n} failed (${r.status})`);return d}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...headers(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const q=await r.text();let d:any;try{d=q?JSON.parse(q):null}catch{d=q}if(!r.ok)throw Error(d?.message||`REST failed (${r.status})`);return d}
const text=(v:any)=>String(v??'').trim();
function ids(ctx:any){return {pid:text(ctx?.product_id||ctx?.entity?.product_id),sku:text(ctx?.sku_id||ctx?.entity?.sku_id)}}
const deep=(q:string)=>/\binvestigate\b|deep dive|full analysis|research this card|why (?:is|did).*(?:spike|move)|what drove/i.test(q);
const external=(q:string)=>/search (?:the )?web|research externally|look online|external research|latest (?:news|articles|discussion)|web research|search online|find (?:recent )?(?:news|articles|discussion)/i.test(q);
async function ensureConversation(t:string,id:any,title:string){if(id){try{const x=await rest(t,`ask_collectish_conversations?id=eq.${encodeURIComponent(String(id))}&select=id&limit=1`);if(x?.[0]?.id)return String(x[0].id)}catch{}}const rows=await rest(t,'ask_collectish_conversations',{method:'POST',prefer:'return=representation',body:[{title:title.slice(0,90)}]});return String(rows?.[0]?.id||'')}
async function saveMessage(t:string,cid:string,role:string,content:string,metadata:any={}){if(!cid)return;await rest(t,'ask_collectish_messages',{method:'POST',prefer:'return=minimal',body:[{conversation_id:cid,role,content,metadata}]}).catch(()=>{})}
function compactInvestigation(s:any){
  if(!s?.available)return null;
  const scout=s.scout||{},sales=s.shared_sales?.summary||{},supply=s.exact_supply?.current||{},edh=(s.edhrec_history?.observations||[]).at?.(-1)||{},cur=s.edhrec_current||{},intel=s.market_intelligence||{},roll=intel.rollup||{};
  return {card:s.card,scout:{grade:scout.promoted_grade,score:scout.promoted_score,market:scout.sku_market_price,direct_low:scout.direct_low,ck_buylist:scout.ck_buylist},sales:{units_90d:sales.units,transactions_90d:sales.transactions,low_sold:sales.low_sold,high_sold:sales.high_sold},supply:{direct_available:supply.direct_available??scout.direct_available,direct_listings:supply.direct_listings??scout.direct_listings,supply_type:supply.supply_type??scout.supply_type,direct_low:supply.direct_low??scout.direct_low},edhrec:{rank:edh.edhrec_rank??cur.edhrec_rank??roll.edhrec_rank??scout.edhrec_rank??null,signal:edh.edhrec_signal,demand_adjustment:edh.demand_adjustment,observed_at:edh.captured_at??cur.observed_at??roll.edhrec_observed_at??null},intel:{claim_count:roll.claim_count||0,source_count:roll.independent_source_count||0,direction_score:roll.intel_direction_score||0,fresh_claims_7d:intel.fresh_claims_7d||0},snapshot_at:s.snapshot_at,investigation_version:s.investigation_version||null};
}
async function fallbackInvestigation(t:string,id:{pid:string,sku:string}){
  const base=await rpc(t,'ask_collectish_get_scout_card',{p_product_id:id.pid||null,p_sku_id:id.sku||null}).catch(()=>null);
  const card=base?.card;if(!base?.found||!card)return null;
  const edh=await rpc(t,'ask_collectish_shared_edhrec',{p_product_id:card.product_id||id.pid||null,p_scryfall_id:card.scryfall_id||null}).catch(()=>null);
  return {available:true,card:{sku_id:card.sku_id,product_id:card.product_id,product_name:card.product_name,set_name:card.set_name,printing:card.printing,condition:card.condition,language:card.language},scout:card,shared_sales:{summary:{}},exact_supply:{current:{direct_available:card.direct_available,direct_listings:card.direct_listings,direct_low:card.direct_low,supply_type:card.supply_type}},edhrec_current:edh||{available:Boolean(card.edhrec_rank),edhrec_rank:card.edhrec_rank},edhrec_history:{observations:[]},market_intelligence:{rollup:{},claims:[],fresh_claims_7d:0},investigation_version:'fallback',snapshot_at:new Date().toISOString()};
}
async function getInvestigation(t:string,id:{pid:string,sku:string}){
  const args={p_product_id:id.pid||null,p_sku_id:id.sku||null};
  const v3=await rpc(t,'ask_collectish_market_investigation_v3',args).catch(()=>null);
  if(v3?.available)return v3;
  return fallbackInvestigation(t,id);
}
function investigationAnswer(s:any){const c=compactInvestigation(s);if(!c)return null;const p=[];p.push(`${c.card?.product_name||'This card'} is Scout ${c.scout.grade||'—'} ${c.scout.score??'—'} with Market ${c.scout.market!=null?'$'+Number(c.scout.market).toFixed(2):'—'}.`);if(c.sales.units_90d!=null)p.push(`Shared TCG history shows ${Number(c.sales.units_90d).toLocaleString()} units across ${Number(c.sales.transactions_90d||0).toLocaleString()} transactions in the last 90 days.`);if(c.supply.direct_available!=null)p.push(`Direct supply is ${Number(c.supply.direct_available).toLocaleString()} copies across ${Number(c.supply.direct_listings||0).toLocaleString()} listings (${c.supply.supply_type||'unclassified'}).`);if(c.edhrec.rank)p.push(`EDHREC rank is #${Number(c.edhrec.rank).toLocaleString()}.`);if(c.intel.claim_count)p.push(`Signals has ${c.intel.claim_count} linked claims from ${c.intel.source_count} independent sources.`);return p.join(' ')}
function investigationSurface(s:any){if(!s?.available)return null;return {type:'market_investigation',domain:'collectish',title:'Market investigation',data:compactInvestigation(s),claims:(s.market_intelligence?.claims||[]).slice(0,6),actions:[{type:'ask',label:'Research externally',prompt:'Research externally on the web for recent events or discussion that could explain this card market move.'},{type:'ask',label:'Compare signals',prompt:'Compare price, sales velocity, supply, EDHREC and linked Signals evidence for this card.'}]}}
function researchSurface(r:any){if(!r?.ok)return null;return {type:'external_research',domain:'web',title:'External evidence',sources:r.sources||[],source_count:r.source_count||0,model:r.model||null}}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return js({error:'POST required'},405);const t=tok(req);if(!t)return js({error:'Authentication required'},401);let body:any;try{body=await req.json()}catch{return js({error:'Invalid JSON'},400)}
  const action=String(body?.action||'chat'),q=text(body?.message||body?.question),ctx=body?.context||{},id=ids(ctx),wantsExternal=action==='chat'&&external(q);
  if(wantsExternal){
    const cid=await ensureConversation(t,body?.conversation_id||null,q).catch(()=>String(body?.conversation_id||''));
    await saveMessage(t,cid,'user',q,{screen:ctx?.screen||'unknown',route:'pass4_external_research'});
    if(!id.pid&&!id.sku){const response='I could not resolve the current card identity for external research. Open a Scout card and try again.';await saveMessage(t,cid,'assistant',response,{route:'pass4_external_research',ok:false});return js({conversation_id:cid||null,response,model:null,usage:null,tools:[],surface_schema:'collectish.ask.surface.v7',surfaces:[],context_screen:ctx?.screen||null,orchestration:{pass3:false,pass4:false,web_search_used:false,external_research_requested:true,external_research_error:'card identity unavailable'}})}
    const inv=await getInvestigation(t,id);
    if(!inv){const response='I could not assemble enough current card evidence to ground web research.';await saveMessage(t,cid,'assistant',response,{route:'pass4_external_research',ok:false});return js({conversation_id:cid||null,response,model:null,usage:null,tools:[],surface_schema:'collectish.ask.surface.v7',surfaces:[],context_screen:ctx?.screen||null,orchestration:{pass3:false,pass4:false,web_search_used:false,external_research_requested:true,external_research_error:'internal evidence unavailable'}})}
    const research=await fn(t,'ask-collectish-web-research',{question:q,card:inv.card,internal_evidence:compactInvestigation(inv)}).catch(e=>({ok:false,error:String(e?.message||e)}));
    const response=research?.answer||`External research failed: ${research?.error||'unknown error'}`;
    const surfaces=[investigationSurface(inv),researchSurface(research)].filter(Boolean);
    const tools=[{name:inv.investigation_version==='fallback'?'market_investigation_fallback':'market_investigation_v3',ok:true,classification:'READ'},...(research?.ok?[{name:'external_web_research',ok:true,classification:'READ'}]:[])];
    await saveMessage(t,cid,'assistant',response,{route:'pass4_external_research',ok:Boolean(research?.ok),source_count:research?.source_count||0,web_search_used:Boolean(research?.ok),investigation_version:inv.investigation_version||null});
    return js({conversation_id:cid||null,response,model:research?.model||null,usage:research?.usage||null,tools,surface_schema:'collectish.ask.surface.v7',surfaces,context_screen:ctx?.screen||null,orchestration:{pass3:true,pass3_version:inv.investigation_version||null,pass4:Boolean(research?.ok),web_search_used:Boolean(research?.ok),external_research_requested:true,external_research_error:research?.ok?null:(research?.error||null),general_agent_bypassed:true}});
  }
  const baseP=fn(t,'ask-collectish-agent-ui',body);
  const needInvestigation=action==='investigate'||(action==='chat'&&deep(q));
  const invP=(needInvestigation&&(id.pid||id.sku))?getInvestigation(t,id):Promise.resolve(null);
  const [base,inv]=await Promise.all([baseP,invP]);
  if(action!=='chat')return js({...base,investigation_v3:inv||null,investigation_version:inv?.investigation_version||null});
  const added=[investigationSurface(inv)].filter(Boolean),existing=Array.isArray(base?.surfaces)?base.surfaces:[],surfaces=[...added,...existing].slice(0,7);
  let response=base?.response;if(inv&&deep(q))response=investigationAnswer(inv)||response;
  const tools=[...(Array.isArray(base?.tools)?base.tools:[])];if(inv)tools.unshift({name:inv.investigation_version==='fallback'?'market_investigation_fallback':'market_investigation_v3',ok:true,classification:'READ'});
  return js({...base,response,tools,surface_schema:'collectish.ask.surface.v7',surfaces,orchestration:{...(base?.orchestration||{}),pass3:Boolean(inv),pass3_version:inv?.investigation_version||null,pass4:false,web_search_used:false}});
});
