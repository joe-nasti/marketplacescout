const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();

export function cardEntityName(item){
  const cards=(Array.isArray(item?.market_intel_entities)?item.market_intel_entities:[]).filter(e=>e?.entity_type==='card');
  return cards[0]?.entity_name||'';
}

export function thesisKey(event,item){
  const card=cardEntityName(item);
  return card?`${String(event?.video_id||'')}|${lower(baseName(card))}`:'';
}

export function aggregateVideoTheses(events=[],items=[]){
  const byIntel=new Map(items.map(x=>[String(x?.intel_id||''),x]));
  const groups=new Map();
  for(const event of events){
    const item=byIntel.get(String(event?.intel_id||''));
    const key=thesisKey(event,item);if(!key)continue;
    const card=cardEntityName(item);
    if(!groups.has(key))groups.set(key,{key,video_id:event.video_id,channel_name:event.channel_name||item?.source_name||'Creator',card_name:card,events:[],items:[]});
    const group=groups.get(key);group.events.push(event);group.items.push(item);
  }
  const theses=[];
  for(const group of groups.values()){
    const moments=group.events.map((event,i)=>({event,item:group.items[i]})).sort((a,b)=>Number(b.event?.prominence||0)-Number(a.event?.prominence||0)||Number(a.event?.start_ms||0)-Number(b.event?.start_ms||0));
    const primary=moments[0];
    const chronological=[...moments].sort((a,b)=>Number(a.event?.start_ms||0)-Number(b.event?.start_ms||0));
    const directions=chronological.map(x=>x.item?.direction).filter(Boolean);
    const direction=directions.includes('bearish')&&!directions.includes('bullish')?'bearish':directions.includes('bullish')&&!directions.includes('bearish')?'bullish':directions.includes('bullish')&&directions.includes('bearish')?'mixed':'neutral';
    theses.push({...group,primary_event:primary.event,primary_item:primary.item,moments:chronological,direction,supporting_count:chronological.length,max_prominence:Math.max(...chronological.map(x=>Number(x.event?.prominence||0)))});
  }
  return theses.sort((a,b)=>b.max_prominence-a.max_prominence||Number(a.primary_event?.start_ms||0)-Number(b.primary_event?.start_ms||0));
}
