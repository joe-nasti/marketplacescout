import { rest } from '../../core/rest.js';

let runSeq=0;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clean=s=>String(s||'').trim();
const lower=s=>clean(s).toLowerCase();
const inFilter=xs=>xs.map(v=>String(v).replace(/[(),]/g,'')).join(',');

function youtubeId(value){
  const raw=clean(value);if(!raw)return'';
  try{
    const u=new URL(raw);
    if(u.hostname==='youtu.be')return u.pathname.split('/').filter(Boolean)[0]||'';
    if(u.hostname.endsWith('youtube.com'))return u.searchParams.get('v')||u.pathname.match(/\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1]||'';
  }catch{}
  return'';
}
function canonicalUrl(value){
  const raw=clean(value);if(!raw)return'';
  try{
    const u=new URL(raw);
    u.hash='';
    for(const key of [...u.searchParams.keys()]){
      const k=lower(key);
      if(k.startsWith('utm_')||['t','time_continue','start','si','feature','pp','ab_channel'].includes(k))u.searchParams.delete(key);
    }
    u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');
    if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');
    return u.toString();
  }catch{return raw}
}
function sourceKey(item,videoIds=[]){
  const vid=videoIds.find(Boolean)||youtubeId(item?.source_url);
  if(vid)return `youtube:${vid}`;
  const url=canonicalUrl(item?.source_url);if(url)return `url:${url}`;
  return `fallback:${lower(item?.source_name)}|${lower(item?.title)}|${lower(item?.source_type)}`;
}
function storyRows(){
  const content=document.querySelector('#cxCompetitiveEvidence.open .cx-evidence-content');
  if(!content)return[];
  return [...content.querySelectorAll('.cx-evidence-source-row')].map(row=>{
    const button=row.querySelector('[data-story-source^="intel:"]');
    const id=button?.dataset.storySource?.slice(6)||'';
    return id?{row,id}:null;
  }).filter(Boolean);
}
function dateLabel(item){
  const value=item?.published_at||item?.observed_at;if(!value)return'';
  const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function rowEvidence(row){
  const texts=[...row.querySelectorAll(':scope > div > small')].map(x=>clean(x.textContent)).filter(Boolean);
  return texts.slice(1).filter((x,i,a)=>a.indexOf(x)===i);
}
function compactMention({item,row,moments}){
  const evidence=rowEvidence(row),time=[...moments].sort((a,b)=>Number(a.start_ms||0)-Number(b.start_ms||0))[0];
  const summary=evidence.find(x=>!/^VIDEO|^YOUTUBE|^ARTICLE|^SOURCE/i.test(x))||clean(item?.summary)||clean(time?.evidence)||'Additional extracted claim from this source.';
  const seconds=Math.max(0,Math.floor(Number(time?.start_ms||0)/1000)),stamp=time?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'';
  return `<div class="cx-story-source-mention"><small>${esc([dateLabel(item),stamp,time?.speaker_name].filter(Boolean).join(' · '))}</small><span>${esc(summary)}</span></div>`;
}
function removeEmptyDateSections(content){
  for(const section of [...content.querySelectorAll(':scope > section')]){
    if(section.querySelector('.cx-evidence-source-row,.cx-evidence-appearance'))continue;
    section.remove();
  }
}
async function collapse(){
  const seq=++runSeq,rows=storyRows();if(rows.length<2)return;
  const ids=[...new Set(rows.map(x=>x.id))];
  const [items,moments]=await Promise.all([
    rest(`market_intel_items?select=intel_id,source_type,source_name,source_url,title,summary,published_at,observed_at&intel_id=in.(${inFilter(ids)})&limit=500`).catch(()=>[]),
    rest(`market_intel_video_events?select=intel_id,video_id,start_ms,evidence,speaker_name&intel_id=in.(${inFilter(ids)})&limit=1000`).catch(()=>[])
  ]);
  if(seq!==runSeq)return;
  const itemById=new Map((items||[]).map(x=>[String(x.intel_id),x])),momentsById=new Map();
  for(const v of moments||[]){const id=String(v.intel_id);if(!momentsById.has(id))momentsById.set(id,[]);momentsById.get(id).push(v)}
  const groups=new Map();
  for(const entry of rows){
    const item=itemById.get(String(entry.id))||{},videos=(momentsById.get(String(entry.id))||[]).map(v=>v.video_id),key=sourceKey(item,videos);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...entry,item,moments:momentsById.get(String(entry.id))||[]});
  }
  for(const entries of groups.values()){
    if(entries.length<2)continue;
    const primary=entries[0],uniqueMentions=[],seen=new Set();
    for(const entry of entries){
      const html=compactMention(entry),plain=html.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().toLowerCase();
      if(seen.has(plain))continue;seen.add(plain);uniqueMentions.push(html);
    }
    const body=primary.row.querySelector(':scope > div');
    if(body){
      const details=document.createElement('details');details.className='cx-story-source-mentions';
      details.innerHTML=`<summary>${entries.length} mentions from this source</summary><div>${uniqueMentions.join('')}</div>`;
      body.appendChild(details);
    }
    primary.row.dataset.sourceMentions=String(entries.length);
    for(const duplicate of entries.slice(1))duplicate.row.remove();
  }
  const content=document.querySelector('#cxCompetitiveEvidence.open .cx-evidence-content');if(content)removeEmptyDateSections(content);
}
function schedule(){for(const ms of [0,80,220,500,1000,1800])setTimeout(()=>void collapse(),ms)}

document.addEventListener('click',event=>{
  if(event.target.closest?.('[data-open-card-evidence],[data-evidence-tab],[data-story-choice],[data-story-sheet-close]'))schedule();
},true);
document.addEventListener('collectish:scout-detail-rendered',schedule);
document.addEventListener('collectish:page-change',schedule);
addEventListener('popstate',schedule);
if(new URL(location.href).searchParams.get('story'))schedule();

window.CollectishSignalStorySourceDedupe={collapse,schedule,sourceKey,canonicalUrl,youtubeId};
