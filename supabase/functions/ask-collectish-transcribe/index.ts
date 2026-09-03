import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const O=Deno.env.get('OPENAI_API_KEY')||'';
const MAX_BYTES=12*1024*1024;
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const MTG_KEYWORDS=['Magic: The Gathering','MTG','TCGplayer','TCG Low','TCG Market','TCG Direct','Direct Low','Direct inventory','Card Kingdom','ManaPool','Scryfall','EDHREC','MTGStocks','Cardmarket','CardTrader','Collectish','Delvin','Scout','Signals','SYP','Store Your Products','buylist','Near Mint','Lightly Played','Moderately Played','Heavily Played','foil','nonfoil','etched foil','surge foil','serialized','borderless','extended art','showcase','retro frame','Collector Booster','Play Booster','Draft Booster','Set Booster','Commander deck','Secret Lair','Universes Beyond','mana value','Commander','Modern','Pioneer','Legacy','cEDH'];
const allowedTypes=/^audio\/(webm|mp4|mpeg|mp3|x-m4a|m4a|ogg|wav|x-wav|flac)$/i;
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const token=(req:Request)=>{const h=req.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const clean=(value:any,max=200)=>String(value??'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
async function user(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const x=await r.json();if(!x?.id)throw Error('Unauthorized');return x}
async function safetyId(id:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`collectish-voice:${id}`));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('')}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return json({error:'POST required'},405);
  const t=token(req);if(!t)return json({error:'Authentication required'},401);
  let account:any;try{account=await user(t)}catch{return json({error:'Authentication required'},401)}
  if(!O)return json({error:'Voice transcription is not configured'},503);
  const declared=Number(req.headers.get('content-length')||0);if(declared>MAX_BYTES+64*1024)return json({error:'Recording is too large'},413);
  let form:FormData;try{form=await req.formData()}catch{return json({error:'Invalid audio upload'},400)}
  const file=form.get('file');if(!(file instanceof File)||!file.size)return json({error:'Audio file required'},400);
  if(file.size>MAX_BYTES)return json({error:'Recording is too large'},413);
  if(file.type&&!allowedTypes.test(file.type))return json({error:'Unsupported audio format'},415);
  const client=clean(form.get('client'),30)||'unknown';
  let context:any={};try{context=JSON.parse(String(form.get('context')||'{}'))}catch{}
  const card=clean(context?.product_name_hint,160);
  const keywords=[...(card?[card]:[]),...MTG_KEYWORDS];
  const prompt=['Transcribe an English Magic: The Gathering collectible-market question exactly.','Use official MTG card, set, treatment, marketplace, and format spellings when the audio supports them.','Preserve prices, quantities, percentages, set codes, collector numbers, foil state, and conditions.','Write TCGplayer, EDHREC, Scryfall, ManaPool, Card Kingdom, MTGStocks, SYP, cEDH, nonfoil, and buylist with these spellings.','Do not answer or explain the question; output only what the speaker said.',card?`The currently selected Collectish product is ${card}.`:null].filter(Boolean).join(' ');
  const upstream=new FormData();
  upstream.append('file',file,file.name||'collectish-voice.webm');
  upstream.append('model','gpt-transcribe');
  upstream.append('response_format','json');
  upstream.append('prompt',prompt);
  upstream.append('languages[]','en');
  keywords.forEach(item=>upstream.append('keywords[]',item));
  const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${O}`,'OpenAI-Safety-Identifier':await safetyId(String(account.id))},body:upstream});
  const raw=await response.text();let data:any;try{data=raw?JSON.parse(raw):{}}catch{data={error:{message:raw}}}
  if(!response.ok){console.error('ask-collectish-transcribe',response.status,clean(data?.error?.message||raw,300));return json({error:response.status===429?'Voice transcription is busy. Try again shortly.':'Voice transcription failed'},response.status===429?429:502)}
  const text=clean(data?.text,8000);if(!text)return json({error:'No speech recognized'},422);
  return json({ok:true,text,model:'gpt-transcribe',client,languages:Array.isArray(data?.languages)?data.languages:[]});
});
