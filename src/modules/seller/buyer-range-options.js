const BUYER_HISTORY='https://store.tcgplayer.com/myaccount/orderhistory';
const RANGE_KEY='collectishBuyerSyncRange';
const HAR_FALLBACK_RANGES=['Last 30 Days','Last 90 Days','Last 120 Days','2026','2025','2024','2023','2022','2021','2020','2019','2018','2017','2016'];
let loading=false;
let liveRanges=[];
let applying=false;

const bridge=()=>window.CollectishReadOnly||null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchBuyerHistoryHtml(){
  const b=bridge();
  if(!b?.startReadOnlyProbe||loading)return null;
  if(b.isBuyerProfileIsolated&&!b.isBuyerProfileIsolated())return null;
  const session=b.getBuyerSessionState?String(b.getBuyerSessionState()||'unknown'):'unknown';
  if(session!=='authenticated')return null;
  loading=true;
  try{
    b.startReadOnlyProbe(JSON.stringify({mode:'fetch_html',method:'GET',url:BUYER_HISTORY,waitMs:5000}));
    const deadline=Date.now()+35000;
    while(Date.now()<deadline){
      await sleep(250);
      const state=String(b.getReadOnlyProbeState?.()||'');
      if(state==='idle'||state==='running')continue;
      let result={};
      try{result=JSON.parse(String(b.getReadOnlyProbeResult?.()||'{}'))}catch{}
      if(state==='ready'&&result.ok&&typeof result.body==='string')return result.body;
      return null;
    }
    return null;
  }finally{loading=false;}
}

function rangesFromHtml(html){
  if(!html)return [];
  const d=new DOMParser().parseFromString(html,'text/html');
  return [...d.querySelectorAll('select[name="DateRange"] option')]
    .map(o=>(o.textContent||'').replace(/\s+/g,' ').trim())
    .filter(Boolean);
}

function labelFor(value){
  if(value==='Last 30 Days')return 'Last 30 days';
  if(value==='Last 90 Days')return 'Last 90 days';
  if(value==='Last 120 Days')return 'Last 120 days';
  return value;
}

function desiredRanges(){return liveRanges.length?liveRanges:HAR_FALLBACK_RANGES;}

function installOptions(ranges=desiredRanges()){
  const select=document.getElementById('cxBuyerSyncRange');
  if(!select||!ranges.length)return false;
  const options=[...new Set([...ranges,'all'])];
  const current=localStorage.getItem(RANGE_KEY)||select.value||'Last 90 Days';
  const existing=[...select.options].map(o=>o.value);
  if(existing.length===options.length&&existing.every((v,i)=>v===options[i]))return true;
  applying=true;
  select.innerHTML=options.map(value=>`<option value="${String(value).replace(/"/g,'&quot;')}">${value==='all'?'All available history':labelFor(value)}</option>`).join('');
  select.dataset.liveRanges=liveRanges.length?'1':'fallback';
  if(options.includes(current))select.value=current;
  else if(options.includes('Last 90 Days'))select.value='Last 90 Days';
  else select.value=options[0];
  select.dispatchEvent(new Event('change',{bubbles:true}));
  applying=false;
  return true;
}

async function refreshRanges(){
  installOptions();
  const html=await fetchBuyerHistoryHtml();
  const ranges=rangesFromHtml(html);
  if(ranges.length){liveRanges=ranges;installOptions(liveRanges);}
}

function schedule(){setTimeout(()=>{installOptions();void refreshRanges();},100);}

const observer=new MutationObserver(()=>{
  if(applying)return;
  const select=document.getElementById('cxBuyerSyncRange');
  if(select)setTimeout(()=>installOptions(),0);
});
observer.observe(document.documentElement,{subtree:true,childList:true});

setInterval(()=>installOptions(),750);

document.addEventListener('collectish:seller-rendered',schedule);
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='seller')schedule()});
document.addEventListener('collectish:ready',()=>setTimeout(()=>void refreshRanges(),500));
document.addEventListener('collectish:buyer-orders-changed',schedule);
setTimeout(()=>{installOptions();void refreshRanges();},300);
