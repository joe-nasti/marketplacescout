let consumed=false;

function consume(){
  if(consumed)return;
  const page=document.getElementById('cxSignals');
  const urlInput=document.getElementById('cxSignalUrl');
  const details=document.getElementById('cxRenderedIntel');
  const titleInput=document.getElementById('cxRenderedTitle');
  const textInput=document.getElementById('cxRenderedText');
  const analyze=document.getElementById('cxAnalyzeRendered');
  if(!page||!urlInput||!details||!titleInput||!textInput||!analyze)return;
  let raw='';
  try{raw=sessionStorage.getItem('collectishPendingRenderedIntel')||''}catch{return}
  if(!raw)return;
  let payload;try{payload=JSON.parse(raw)}catch{try{sessionStorage.removeItem('collectishPendingRenderedIntel')}catch{};return}
  const url=String(payload?.url||'').trim();
  const text=String(payload?.text||'').trim();
  if(!url||text.length<120)return;
  consumed=true;
  try{sessionStorage.removeItem('collectishPendingRenderedIntel')}catch{}
  urlInput.value=url;
  titleInput.value=String(payload?.title||'');
  textInput.value=text;
  details.open=true;
  const msg=document.getElementById('cxRenderedMsg');
  if(msg)msg.textContent='Shared page captured. Analyzing rendered text…';
  setTimeout(()=>analyze.click(),80);
}

document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(consume)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(consume)});
document.addEventListener('collectish:feature-modules-ready',()=>queueMicrotask(consume));
queueMicrotask(consume);
