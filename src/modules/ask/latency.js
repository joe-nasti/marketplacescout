const KEY='COLLECTISH_ASK_LATENCY_V1';
const MAX=40;
const now=()=>performance.now();

function read(){try{const v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function write(rows){try{localStorage.setItem(KEY,JSON.stringify(rows.slice(-MAX)))}catch{}}
function round(v){return v==null?null:Math.max(0,Math.round(v))}

export function beginAskLatencySample({screen='unknown'}={}){
  const t0=now();let headersAt=null,metaAt=null,firstDeltaAt=null,cached=false,finished=false;
  return {
    headers(){if(headersAt==null)headersAt=now()},
    meta(data={}){if(metaAt==null)metaAt=now();cached=Boolean(data.cached)},
    delta(){if(firstDeltaAt==null)firstDeltaAt=now()},
    finish({aborted=false,error=false}={}){
      if(finished)return;finished=true;
      const doneAt=now();
      const row={
        at:Date.now(),screen,cached,aborted,error,
        headersMs:round(headersAt==null?null:headersAt-t0),
        metaMs:round(metaAt==null?null:metaAt-t0),
        ttftMs:round(firstDeltaAt==null?null:firstDeltaAt-t0),
        totalMs:round(doneAt-t0),
        prefetched:Boolean(window.CollectishAskPrefetch?.state?.().cacheSize)
      };
      const rows=read();rows.push(row);write(rows);
      document.dispatchEvent(new CustomEvent('collectish:ask-latency-sample',{detail:row}));
      return row;
    }
  };
}

export function getAskLatencyStats(){
  const rows=read(),completed=rows.filter(r=>!r.aborted&&!r.error&&r.ttftMs!=null);
  const avg=k=>{const a=completed.map(r=>Number(r[k])).filter(Number.isFinite);return a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null};
  return {count:completed.length,last:completed.at(-1)||null,avg:{headersMs:avg('headersMs'),metaMs:avg('metaMs'),ttftMs:avg('ttftMs'),totalMs:avg('totalMs')},rows};
}

export function clearAskLatencyStats(){try{localStorage.removeItem(KEY)}catch{}}
window.CollectishAskLatency={stats:getAskLatencyStats,clear:clearAskLatencyStats};
