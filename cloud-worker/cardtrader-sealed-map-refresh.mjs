const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};

async function sb(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);
  return d;
}
async function all(path,pageSize=1000){
  const out=[];
  for(let offset=0;;offset+=pageSize){
    const sep=path.includes('?')?'&':'?';
    const rows=await sb(`${path}${sep}limit=${pageSize}&offset=${offset}`)||[];
    out.push(...rows);
    if(rows.length<pageSize)break;
  }
  return out;
}
function norm(v){return v==null||v===''?null:String(v)}
function uniqueOne(values){const s=[...new Set(values.filter(Boolean))];return s.length===1?s[0]:null}
function chunks(a,n){const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out}
async function upsert(rows){for(const batch of chunks(rows,200))await sb('cardtrader_sealed_map?on_conflict=sealed_uuid',{method:'POST',body:batch,prefer:'resolution=merge-duplicates,return=minimal'})}

const started=new Date().toISOString();
const [products,blueprints]=await Promise.all([
  all('mtgjson_sealed_products?select=uuid,cardmarket_id,tcgplayer_product_id'),
  all('cardtrader_blueprints?select=blueprint_id,cardmarket_ids,tcgplayer_product_id')
]);
const byCmk=new Map(),byTcg=new Map();
for(const p of products){
  const cmk=norm(p.cardmarket_id),tcg=norm(p.tcgplayer_product_id);
  if(cmk){const a=byCmk.get(cmk)||[];a.push(String(p.uuid));byCmk.set(cmk,a)}
  if(tcg){const a=byTcg.get(tcg)||[];a.push(String(p.uuid));byTcg.set(tcg,a)}
}
const maps=[],conflicts=[];
for(const b of blueprints){
  const cmkCandidates=[];
  for(const id of(Array.isArray(b.cardmarket_ids)?b.cardmarket_ids:[]))for(const u of(byCmk.get(String(id))||[]))cmkCandidates.push(u);
  const tcgCandidates=b.tcgplayer_product_id?(byTcg.get(String(b.tcgplayer_product_id))||[]):[];
  const cmk=uniqueOne(cmkCandidates),tcg=uniqueOne(tcgCandidates);
  if(cmk&&tcg&&cmk!==tcg){conflicts.push({blueprint_id:b.blueprint_id,cardmarket_uuid:cmk,tcgplayer_uuid:tcg});continue}
  const sealedUuid=cmk||tcg;if(!sealedUuid)continue;
  const method=cmk&&tcg?'dual_exact':cmk?'cardmarket_exact':'tcgplayer_exact';
  maps.push({sealed_uuid:sealedUuid,cardtrader_blueprint_id:Number(b.blueprint_id),cardmarket_id:(Array.isArray(b.cardmarket_ids)?b.cardmarket_ids:[]).find(id=>(byCmk.get(String(id))||[]).includes(sealedUuid))||null,tcgplayer_product_id:norm(b.tcgplayer_product_id),match_method:method,match_confidence:method==='dual_exact'?'a_plus':'a',identity_conflict:false,conflict_detail:{},verified_at:new Date().toISOString()});
}
await upsert(maps);
const detail={started_at:started,products_scanned:products.length,blueprints_scanned:blueprints.length,mapped:maps.length,conflicts:conflicts.length,conflict_sample:conflicts.slice(0,20),pagination:true};
await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'cardtrader_sealed_map',last_started_at:started,last_completed_at:new Date().toISOString(),row_count:maps.length,status:conflicts.length?'complete_with_warnings':'complete',detail}],prefer:'resolution=merge-duplicates,return=minimal'});
console.log(JSON.stringify(detail));
