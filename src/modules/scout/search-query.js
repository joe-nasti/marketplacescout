const KEY_ALIASES={s:'set',set:'set',cn:'collectorNumber',f:'finish',finish:'finish'};
const FINISH_ALIASES={foil:'foil',f:'foil',nonfoil:'nonfoil',normal:'nonfoil',n:'nonfoil',etched:'etched',e:'etched'};
const TOKEN_RE=/^([a-zA-Z]+):(.*)$/;

const unique=xs=>[...new Set(xs)];
const normalizeSet=value=>String(value||'').trim().toUpperCase();
const normalizeCollector=value=>String(value||'').trim();
const normalizeFinish=value=>FINISH_ALIASES[String(value||'').trim().toLowerCase()]||null;

export function parseScoutSearchQuery(raw=''){
  const parts=String(raw).trim().split(/\s+/).filter(Boolean);
  const nameParts=[],tokens=[],unknownTokens=[],setCodes=[],collectorNumbers=[],finishes=[];

  for(const part of parts){
    const match=part.match(TOKEN_RE);
    if(!match){nameParts.push(part);continue}
    const [,rawKey,rawValue]=match,key=rawKey.toLowerCase(),value=rawValue.trim(),kind=KEY_ALIASES[key];
    if(!kind||!value){tokens.push({raw:part,kind:'unknown',key,value});unknownTokens.push(part);continue}
    if(kind==='set'){
      const normalizedValue=normalizeSet(value);
      tokens.push({raw:part,kind,key,value,normalizedValue});setCodes.push(normalizedValue);continue;
    }
    if(kind==='collectorNumber'){
      const normalizedValue=normalizeCollector(value);
      tokens.push({raw:part,kind,key,value,normalizedValue});collectorNumbers.push(normalizedValue);continue;
    }
    const normalizedValue=normalizeFinish(value);
    if(!normalizedValue){tokens.push({raw:part,kind:'unknown',key,value});unknownTokens.push(part);continue}
    tokens.push({raw:part,kind,key,value,normalizedValue});finishes.push(normalizedValue);
  }

  return {raw:String(raw),nameText:nameParts.join(' ').trim(),tokens,filters:{setCodes:unique(setCodes),collectorNumbers:unique(collectorNumbers),finishes:unique(finishes)},unknownTokens};
}

export function filterScoutPrintings(printings,query){
  const {setCodes=[],collectorNumbers=[],finishes=[]}=query?.filters||{};
  return (printings||[]).filter(card=>{
    if(setCodes.length&&!setCodes.includes(String(card?.set||'').toUpperCase()))return false;
    if(collectorNumbers.length&&!collectorNumbers.includes(String(card?.collector_number||'').trim()))return false;
    if(finishes.length){const cardFinishes=(card?.finishes||[]).map(x=>String(x).toLowerCase());if(!finishes.some(x=>cardFinishes.includes(x)))return false}
    return true;
  });
}

export function removeScoutSearchToken(raw,tokenRaw){
  let removed=false;
  return String(raw||'').trim().split(/\s+/).filter(part=>{if(!removed&&part===tokenRaw){removed=true;return false}return true}).join(' ');
}
