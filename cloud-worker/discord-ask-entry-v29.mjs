import entry from './discord-ask-entry-v28.mjs';

function base(env){return String(env.SUPABASE_URL||'').replace(/\/$/,'')}
function svcHeaders(env){return{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'}}
async function rest(env,path,opt={}){const r=await fetch(`${base(env)}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...svcHeaders(env),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d=null;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`Supabase REST ${r.status}`);return d}
const norm=v=>String(v||'').toLowerCase().replace(/\s*\/\/\s*.*/,'').replace(/\([^)]*\)\s*$/,'').replace(/[^a-z0-9]+/g,' ').trim();
function moveAlias(q){q=String(q||'').trim();for(const p of[/^why\s+(?:did|has)\s+(.+?)\s+(?:spike|spiked|move|moved|jump|jumped|rise|rose|rally|rallied)\??$/i,/^why\s+is\s+(.+?)\s+(?:spiking|moving|rising|jumping|up)\??$/i]){const m=q.match(p);if(m?.[1])return m[1].trim().replace(/[?.!,]+$/g,'')}return null}
async function lookup(env,q){const x=await rest(env,'rpc/ask_collectish_public_card_lookup_v1',{method:'POST',body:{p_query:q,p_limit:40}}).catch(()=>[]);const rows=Array.isArray(x)?x:[];const bySku=new Map();for(const r of rows){const k=String(r.sku_id||`${r.product_id}|${r.card_name}|${r.printing}`);const old=bySku.get(k);if(!old||(!old.scryfall_id&&r.scryfall_id))bySku.set(k,r)}return[...bySku.values()]}
async function signals(env,term){const cut=new Date(Date.now()-21*86400000).toISOString(),t=encodeURIComponent(`*${term}*`);return rest(env,`market_intel_items?observed_at=gte.${encodeURIComponent(cut)}&or=(title.ilike.${t},summary.ilike.${t})&select=title,summary,observed_at&order=observed_at.desc&limit=120`).catch(()=>[])}
function parseMove(s){const m=String(s?.summary||'').match(/MTGStocks Interests\s+(average|market)\s+(foil|regular|nonfoil|non-foil)\s+\d+d:\s*(.+?)\s+moved from \$([\d.]+) to \$([\d.]+) \(([+-]?[\d.]+)%\)/i);return m?{metric:m[1].toLowerCase(),finish:m[2].toLowerCase(),card_name:m[3].trim(),change:+m[6]}:null}
function isFoilPrinting(v){const s=String(v||'').toLowerCase();return s.includes('foil')&&!s.includes('non foil')&&!s.includes('non-foil')}
function identityMatches(row,move){const r=norm(row?.card_name),m=norm(move?.card_name);if(!r||!m)return false;return r===m||r.startsWith(`${m} `)||m.startsWith(`${r} `)}
async function discover(env,productId,finish){const r=await fetch(`${base(env)}/functions/v1/scout-tcgplayer-sku-discovery`,{method:'POST',headers:svcHeaders(env),body:JSON.stringify({product_id:String(productId),desired_finish:finish,desired_condition:'NEAR MINT',desired_language:'ENGLISH',persist:true,reason:'discord_market_move_missing_printing'})});const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`SKU discovery ${r.status}`);return d}
async function enrichMissingPrintings(env,question){const alias=moveAlias(question);if(!alias)return;const [rows,sig]=await Promise.all([lookup(env,alias),signals(env,alias)]);if(!rows.length||!sig.length)return;const moves=sig.map(parseMove).filter(Boolean);const calls=new Map();for(const m of moves){const matching=rows.filter(r=>identityMatches(r,m));if(!matching.length)continue;const wantFoil=m.finish==='foil';const hasFinish=matching.some(r=>isFoilPrinting(r.printing)===wantFoil);if(hasFinish)continue;for(const r of matching){if(!r.product_id)continue;const key=`${r.product_id}|${wantFoil?'foil':'nonfoil'}`;if(!calls.has(key))calls.set(key,{productId:r.product_id,finish:wantFoil?'foil':'nonfoil'})}}
for(const x of calls.values()){try{await discover(env,x.productId,x.finish)}catch(e){console.warn('TCGplayer on-demand SKU discovery failed',x,String(e))}}
}

export default{
  fetch(request,env,ctx){return entry.fetch(request,env,ctx)},
  async queue(batch,env,ctx){
    for(const message of batch.messages){
      const job=message?.body||{};
      if(String(job.response_visibility||'').toLowerCase()==='ephemeral')continue;
      try{await enrichMissingPrintings(env,job.question)}catch(e){console.warn('Preflight SKU discovery failed',String(e))}
    }
    return entry.queue(batch,env,ctx);
  }
};
