import { rest } from '../../core/rest.js';
import { invokeFunction } from '../../core/functions.js';

const LIVE_NAME='Secret Lair: A Perfectly Normal Superdrop';
let busy=false;

function ensure(){
  const panel=document.getElementById('cxSecretLairAdmin');if(!panel)return null;
  const actions=panel.querySelector('.cx-admin-actions');if(!actions)return null;
  let b=actions.querySelector('[data-sl-score]');if(b)return b;
  b=document.createElement('button');b.type='button';b.dataset.slScore='1';b.textContent='Score US foil + nonfoil';
  b.addEventListener('click',()=>void scoreLive());actions.appendChild(b);return b;
}
function message(text,error=false){const el=document.getElementById('cxSecretLairMessage');if(el){el.textContent=text;el.classList.toggle('cx-admin-error',error)}}
async function liveDrops(){
  const releases=await rest(`secret_lair_releases?select=release_id&release_name=eq.${encodeURIComponent(LIVE_NAME)}&limit=1`,{force:true});
  const releaseId=releases?.[0]?.release_id;if(!releaseId)return[];
  return rest(`secret_lair_drops?select=drop_id,drop_name&release_id=eq.${releaseId}&order=created_at.asc`,{force:true});
}
async function scoreLive(){
  if(busy)return;const button=ensure();if(!button)return;busy=true;button.disabled=true;
  try{
    let drops=await liveDrops();if(!drops.length){await window.CollectishSecretLairAdmin?.seed?.();drops=await liveDrops()}
    if(!drops.length)throw new Error('No live Secret Lair drops are seeded.');
    let attempted=0,scored=0,blocked=0;const recs=[];
    for(const drop of drops){
      for(const finish of ['nonfoil','foil']){
        attempted++;message(`Scoring ${attempted}/${drops.length*2}: ${drop.drop_name} · ${finish}…`);
        const out=await invokeFunction('secret-lair-score',{drop_id:drop.drop_id,region:'US',finish});
        if(out?.scored){scored++;recs.push(`${drop.drop_name} ${finish}: ${String(out.recommendation||'watch').replaceAll('_',' ')}`)}else blocked++;
      }
    }
    message(`US valuation complete: ${scored}/${attempted} finishes scored; ${blocked} held back for insufficient market coverage. ${recs.slice(0,3).join(' · ')}${recs.length>3?' · …':''}`);
    await window.CollectishSecretLairAdmin?.refresh?.(true);
  }catch(e){message(`Scoring failed: ${e.message||e}`,true)}finally{busy=false;button.disabled=false}
}

document.addEventListener('collectish:admin-modules-ready',()=>setTimeout(ensure,0));
document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles')setTimeout(ensure,0)});
setTimeout(ensure,0);
window.CollectishSecretLairScoring={scoreLive};
