import store from '../../state/store.js';
import {rest} from '../../core/rest.js';
import {readSession} from '../../core/session.js';

const POLL_MS=5000;
let timer=0;
let busy=false;
let trackedSearch='';

const enc=v=>encodeURIComponent(String(v??''));

function paint(percent,detail,done=false){
  const box=document.querySelector('#cxSeller .cx-seller-sync-progress');
  if(box){
    box.hidden=false;
    const fill=box.querySelector('.cx-seller-sync-progress-fill');
    const pct=box.querySelector('.cx-seller-sync-progress-pct');
    const text=box.querySelector('.cx-seller-sync-progress-detail');
    if(fill)fill.style.width=`${Math.max(0,Math.min(100,Math.round(percent)))}%`;
    if(pct)pct.textContent=`${Math.max(0,Math.min(100,Math.round(percent)))}%`;
    if(text)text.textContent=detail;
  }
  const button=document.getElementById('cxSellerParityRefresh');
  if(button){button.disabled=!done;button.textContent=done?'Refresh':'Refreshing…';}
}

function schedule(){clearTimeout(timer);timer=setTimeout(sync,POLL_MS)}

async function sync(){
  if(busy||document.hidden)return schedule();
  const userId=readSession()?.user?.id;if(!userId)return;
  busy=true;
  try{
    const jobs=await rest(`collector_jobs?select=job_id,status,priority,payload_json,progress_json,created_at,error_message&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&order=created_at.desc&limit=150`);
    const searches=(jobs||[]).filter(j=>j.status==='completed'&&j.payload_json?.sellerHistoryKind==='order_search'&&j.payload_json?.manualSellerRefresh===true&&Number(j.progress_json?.interactiveDetailJobsQueued||0)>0);
    const search=trackedSearch?searches.find(j=>j.job_id===trackedSearch):searches[0];
    if(!search)return;
    trackedSearch=search.job_id;
    const expected=Number(search.progress_json?.interactiveDetailJobsQueued||0);
    const children=(jobs||[]).filter(j=>j.payload_json?.sellerHistoryKind==='order_detail'&&j.payload_json?.sellerHistoryParentJobId===search.job_id&&j.payload_json?.requestClass==='interactive');
    const normalized=children.filter(j=>j.status==='completed'&&Boolean(j.progress_json?.orchestratedAt)).length;
    const failed=children.filter(j=>j.status==='failed').length;
    const pending=Math.max(0,expected-normalized-failed);
    if(pending>0){
      const pct=86+Math.round(13*(normalized/Math.max(1,expected)));
      const detail=`Order list refreshed · enriching ${pending} recent order detail${pending===1?'':'s'}${normalized?` · ${normalized} done`:''}`;
      store.update('seller',{manualSyncStatus:'running',manualSyncPercent:pct,manualSyncDetail:detail});
      paint(pct,detail,false);
      window.CollectishSellerAgent?.run?.().catch?.(()=>{});
      return schedule();
    }
    const detail=failed?`Refresh complete · ${normalized} order details enriched · ${failed} detail failure${failed===1?'':'s'}`:`Refresh complete · ${normalized} order detail${normalized===1?'':'s'} enriched`;
    store.update('seller',{manualSyncStatus:'done',manualSyncPercent:100,manualSyncDetail:detail});
    paint(100,detail,true);
    trackedSearch='';
    window.CollectishSellerFreshness?.check?.({forceReload:true}).catch?.(()=>{});
  }catch(error){console.warn('Seller interactive detail progress',error);schedule()}
  finally{busy=false}
}

function maybeTrack(status){
  if(status!=='done')return;
  setTimeout(()=>sync().catch(()=>{}),150);
}

store.subscribe(s=>s.seller?.manualSyncStatus,status=>maybeTrack(status),{immediate:false});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&trackedSearch)sync().catch(()=>{})});
document.addEventListener('collectish:seller-rendered',()=>{if(trackedSearch)sync().catch(()=>{})});
