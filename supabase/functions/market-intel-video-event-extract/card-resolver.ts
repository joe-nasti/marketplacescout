const norm=(s:any)=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const clamp=(n:any)=>Number.isFinite(Number(n))?Math.max(0,Math.min(1,Number(n))):0.5;

const GLOBAL_ALIASES=new Map<string,string>([
  ['fomo','Fear of Missing Out'],['gsz',"Green Sun's Zenith"],['green sun zenith',"Green Sun's Zenith"],
  ['green suns zenith',"Green Sun's Zenith"],['bobble',"Mishra's Bauble"],['bauble',"Mishra's Bauble"],
  ['mishras bobble',"Mishra's Bauble"],['street rays','Street Wraith'],['street ray','Street Wraith'],
  ['collector oof','Collector Ouphe'],['collector oofe','Collector Ouphe'],['oof','Collector Ouphe'],
  ['king tchala',"King T'Challa"],['king tala',"King T'Challa"],['king dchala',"King T'Challa"],['tchala',"King T'Challa"]
]);
const CREATOR_ALIASES:Record<string,Map<string,string>>={
  aspiringspike:new Map([['fomo','Fear of Missing Out'],['gsz',"Green Sun's Zenith"],['bobble',"Mishra's Bauble"],['oof','Collector Ouphe']])
};

function editDistance(a:string,b:string){const x=norm(a),y=norm(b);if(x===y)return 0;if(!x.length)return y.length;if(!y.length)return x.length;let prev=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const cur=[i];for(let j=1;j<=y.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev=cur}return prev[y.length]}
function similarity(a:string,b:string){const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 1;return 1-editDistance(x,y)/Math.max(x.length,y.length)}
function creatorKey(channel:string){return norm(channel).replace(/\s+/g,'')}

async function scryfall(name:string,mode:'exact'|'fuzzy'){try{const r=await fetch(`https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(name)}`,{headers:{'User-Agent':'MarketplaceScout/0.7 (+creator video card resolver)'}});if(!r.ok)return null;const c=await r.json();return c?.id?{name:String(c.name||name),scryfall_id:String(c.id),set_code:c.set?String(c.set):null,oracle_text:String(c.oracle_text||''),type_line:String(c.type_line||'')}:null}catch{return null}}

export type ResolvedVideoCard={name:string,scryfall_id:string,set_code:string|null,oracle_text:string,type_line:string,raw_mention:string,resolution_method:string,resolution_confidence:number};
export type ResolverContext={channel_name?:string,nearby_text?:string,deck_cards?:string[],model_resolve?:(prompt:string)=>Promise<any>};

export async function resolveVideoCard(raw:string,ctx:ResolverContext={}):Promise<ResolvedVideoCard|null>{
  const key=norm(raw),creator=CREATOR_ALIASES[creatorKey(ctx.channel_name||'')];
  const alias=creator?.get(key)||GLOBAL_ALIASES.get(key)||null;
  if(alias){const card=await scryfall(alias,'exact');if(card)return{...card,raw_mention:raw,resolution_method:'alias',resolution_confidence:.995}}

  const deck=(ctx.deck_cards||[]).filter(Boolean);
  if(deck.length){
    const exactDeck=deck.find(n=>norm(n)===key);if(exactDeck){const card=await scryfall(exactDeck,'exact');if(card)return{...card,raw_mention:raw,resolution_method:'deck_exact',resolution_confidence:1}}
    const ranked=deck.map(name=>({name,score:similarity(raw,name)})).sort((a,b)=>b.score-a.score);
    if(ranked[0]?.score>=.68&&(ranked.length===1||ranked[0].score-ranked[1].score>=.08)){const card=await scryfall(ranked[0].name,'exact');if(card)return{...card,raw_mention:raw,resolution_method:'deck_fuzzy',resolution_confidence:Math.min(.97,ranked[0].score+.12)}}
  }

  const exact=await scryfall(raw,'exact');if(exact)return{...exact,raw_mention:raw,resolution_method:'exact',resolution_confidence:1};
  const fuzzy=await scryfall(raw,'fuzzy');if(fuzzy&&similarity(raw,fuzzy.name)>=.80)return{...fuzzy,raw_mention:raw,resolution_method:'fuzzy',resolution_confidence:.9};

  if(ctx.model_resolve){try{const response=await ctx.model_resolve(`Resolve this spoken/auto-captioned Magic: The Gathering card reference. It may be phonetic, abbreviated, misspelled, or a nickname. Return JSON {"canonical_name":string|null,"confidence":number}. If ambiguous return null. Raw mention: ${raw}. Deck candidates: ${deck.slice(0,100).join(' | ')||'none'}. Nearby transcript: ${(ctx.nearby_text||'').slice(0,2200)}`);const name=String(response?.canonical_name||'').trim(),confidence=clamp(response?.confidence);if(name&&confidence>=.72){const card=await scryfall(name,'exact')||await scryfall(name,'fuzzy');if(card)return{...card,raw_mention:raw,resolution_method:'contextual',resolution_confidence:confidence}}}catch{}
  }
  return null;
}
