import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

let syncing=false;
const FORMATS=['Standard','Pioneer','Modern','Legacy','Pauper'];
function panel(){return document.getElementById('cxCompetitiveIntel')}
function ensureButton(){
  const p=panel();if(!p||document.getElementById('cxRefreshTopDeck'))return;
  const mtgo=document.getElementById('cxRefreshMtgo');if(!mtgo)return;
  const b=document.createElement('button');b.type='button';b.className='cx-refresh';b.id='cxRefreshTopDeck';b.textContent='Refresh paper';b.title='Import recent paper Standard, Pioneer, Modern, Legacy and Pauper tournaments from TopDeck.gg';
  mtgo.insertAdjacentElement('afterend',b);b.addEventListener('click',sync);
  const note=document.createElement('p');note.className='cx-sub';note.dataset.topdeckAttribution='1';note.innerHTML='Paper constructed tournament data provided by <a href="https://topdeck.gg" target="_blank" rel="noopener">TopDeck.gg ↗</a>. MTGO remains the primary source for digital MTGO events.';
  p.querySelector('.cx-page-head')?.insertAdjacentElement('afterend',note);
}
async function sync(){
  if(syncing)return;syncing=true;const b=document.getElementById('cxRefreshTopDeck'),old=b?.textContent||'Refresh paper';if(b){b.disabled=true;b.textContent='Refreshing…'}
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);
    let data;
    try{
      const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/competitive-topdeck-sync`,{method:'POST',signal:controller.signal,headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({formats:FORMATS,days:21,min_size:16,per_format:1})});
      const text=await r.text();try{data=text?JSON.parse(text):{}}catch{data={error:'TopDeck sync returned unreadable data.'}}
      if(!r.ok)throw new Error(data?.error||`TopDeck sync HTTP ${r.status}`);
    } finally {clearTimeout(timer)}
    document.dispatchEvent(new CustomEvent('collectish:competitive-changed',{detail:{source:'topdeck-paper',...data}}));
    const msg=document.getElementById('cxCompetitiveMsg');if(msg)msg.textContent=`Paper: imported ${data.events||0} event${Number(data.events)===1?'':'s'}, ${data.decks||0} entries and ${data.cards||0} structured card rows from TopDeck.gg.${data.errors?` ${data.errors} event${Number(data.errors)===1?'':'s'} failed.`:''}`;
  }catch(e){const msg=document.getElementById('cxCompetitiveMsg');if(msg)msg.textContent=e?.name==='AbortError'?'Paper refresh timed out after 65 seconds.':(e?.message||'Could not refresh paper tournaments.')}
  finally{syncing=false;const current=document.getElementById('cxRefreshTopDeck');if(current){current.disabled=false;current.textContent=old}}
}
function ensure(){setTimeout(ensureButton,0);setTimeout(ensureButton,120)}
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')ensure()});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')ensure()});
document.addEventListener('collectish:competitive-changed',ensure);
ensure();
export {sync as syncCompetitivePaper};
