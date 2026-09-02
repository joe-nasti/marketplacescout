const KEY='collectishRuntimeHealth';
const origin=Number(window.__CollectishStartupStartedAt||performance.now());

function write(patch){
  let current={};
  try{current=JSON.parse(sessionStorage.getItem(KEY)||'{}')}catch{}
  const next={...current,...patch,last_event_at:new Date().toISOString()};
  try{sessionStorage.setItem(KEY,JSON.stringify(next))}catch{}
  document.dispatchEvent(new CustomEvent('collectish:runtime-health',{detail:patch}));
  return next;
}

export function startupNow(){return performance.now()}
export function recordStartupDuration(key,started=origin){
  const value=Math.max(0,Math.round(performance.now()-Number(started||origin)));
  write({[key]:value});
  return value;
}
export function recordStartupFlag(key,value=true){write({[key]:value})}

