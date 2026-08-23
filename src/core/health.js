import { readMetrics } from './rest.js';

const started=performance.now();
const KEY='collectishRuntimeHealth';
let clsTotal=0;
let longTaskCount=0;
let longTaskTotal=0;
let longTaskMax=0;

function writeMetrics(patch){
  const next={...readMetrics(),...patch};
  try{sessionStorage.setItem(KEY,JSON.stringify(next))}catch{}
  return next;
}

const fmtMs=value=>value==null?'—':value<1000?`${Math.round(value)} ms`:`${(Number(value)/1000).toFixed(2)} s`;
const fmtBytes=value=>value==null?'—':Number(value)<1024?`${Math.round(Number(value))} B`:Number(value)<1024*1024?`${(Number(value)/1024).toFixed(1)} KB`:`${(Number(value)/(1024*1024)).toFixed(2)} MB`;
const clean=value=>String(value??'').replace(/[<>]/g,'');

function captureNavigation(){
  const nav=performance.getEntriesByType?.('navigation')?.[0];
  if(!nav)return;
  const resources=performance.getEntriesByType?.('resource')||[];
  const transfer=resources.reduce((sum,e)=>sum+Number(e.transferSize||0),0)+Number(nav.transferSize||0);
  writeMetrics({
    browser_ttfb_ms:Math.round(nav.responseStart||0),
    browser_dom_content_loaded_ms:Math.round(nav.domContentLoadedEventEnd||0),
    browser_load_ms:Math.round(nav.loadEventEnd||0),
    browser_resource_count:resources.length,
    browser_transfer_bytes:transfer
  });
}

function observePerformance(){
  captureNavigation();
  if(typeof PerformanceObserver!=='function')return;
  try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.name==='first-contentful-paint')writeMetrics({browser_fcp_ms:Math.round(entry.startTime)})}).observe({type:'paint',buffered:true})}catch{}
  try{new PerformanceObserver(list=>{const entries=list.getEntries(),last=entries[entries.length-1];if(last)writeMetrics({browser_lcp_ms:Math.round(last.startTime)})}).observe({type:'largest-contentful-paint',buffered:true})}catch{}
  try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)clsTotal+=Number(entry.value||0);writeMetrics({browser_cls:Number(clsTotal.toFixed(4))})}).observe({type:'layout-shift',buffered:true})}catch{}
  try{new PerformanceObserver(list=>{for(const entry of list.getEntries()){const duration=Number(entry.duration||0);longTaskCount+=1;longTaskTotal+=duration;longTaskMax=Math.max(longTaskMax,duration)}writeMetrics({browser_long_task_count:longTaskCount,browser_long_task_total_ms:Math.round(longTaskTotal),browser_long_task_max_ms:Math.round(longTaskMax)})}).observe({type:'longtask',buffered:true})}catch{}
  addEventListener('load',()=>setTimeout(captureNavigation,0),{once:true});
}

function endpointStatsHtml(metrics){
  const rows=Object.entries(metrics.rest_endpoint_stats||{}).map(([name,s])=>({name,...s,avgMs:Number(s?.count||0)?Number(s?.totalMs||0)/Number(s.count):0})).sort((a,b)=>Number(b.totalMs||0)-Number(a.totalMs||0)).slice(0,8);
  if(!rows.length)return '<div class="cx-empty">No authenticated Supabase calls measured in this session yet.</div>';
  return `<div class="cx-detail-list">${rows.map(r=>`<div class="cx-detail-stat"><span>${clean(r.name)} · ${Number(r.count||0)} req</span><strong>${fmtMs(r.totalMs)} total · ${fmtMs(r.maxMs)} max</strong><small>${fmtMs(r.avgMs)} avg · ${fmtBytes(r.bytes)} · ${Number(r.errors||0)} error${Number(r.errors||0)===1?'':'s'}</small></div>`).join('')}</div>`;
}

export function renderRuntimeHealth(){
  const host=document.getElementById('cxAdmin');
  if(!host)return;
  let box=host.querySelector('.cx-runtime-health');
  if(!box){box=document.createElement('div');box.className='cx-card cx-span-12 cx-runtime-health';(host.querySelector('.cx-grid')||host).append(box)}
  const metrics=readMetrics();
  const retries=Number(metrics.statement_timeout_retries||0),recoveries=Number(metrics.statement_timeout_recoveries||0),failures=Number(metrics.statement_timeout_failures||0);
  const cache=metrics.scout_cache_used===true?`Used · ${fmtMs(metrics.scout_cache_read_ms)}`:metrics.scout_cache_fallback?`Fallback · ${fmtMs(metrics.scout_cache_read_ms)}`:'—';
  box.innerHTML=`<div class="cx-section-title">Runtime health</div><div class="cx-detail-list">
    <div class="cx-detail-stat"><span>Scout first load</span><strong>${fmtMs(metrics.scout_first_load_ms)}</strong></div>
    <div class="cx-detail-stat"><span>Startup cache hydration</span><strong>${fmtMs(metrics.startup_cache_hydration_ms)}</strong></div>
    <div class="cx-detail-stat"><span>Startup Scout modules</span><strong>${fmtMs(metrics.startup_scout_modules_ms)}</strong></div>
    <div class="cx-detail-stat"><span>Scout ranking cache</span><strong>${cache}</strong></div>
    <div class="cx-detail-stat"><span>TTFB</span><strong>${fmtMs(metrics.browser_ttfb_ms)}</strong></div>
    <div class="cx-detail-stat"><span>First contentful paint</span><strong>${fmtMs(metrics.browser_fcp_ms)}</strong></div>
    <div class="cx-detail-stat"><span>Largest contentful paint</span><strong>${fmtMs(metrics.browser_lcp_ms)}</strong></div>
    <div class="cx-detail-stat"><span>DOMContentLoaded</span><strong>${fmtMs(metrics.browser_dom_content_loaded_ms)}</strong></div>
    <div class="cx-detail-stat"><span>Page load</span><strong>${fmtMs(metrics.browser_load_ms)}</strong></div>
    <div class="cx-detail-stat"><span>Layout shift (CLS)</span><strong>${metrics.browser_cls==null?'—':Number(metrics.browser_cls).toFixed(3)}</strong></div>
    <div class="cx-detail-stat"><span>Long tasks</span><strong>${Number(metrics.browser_long_task_count||0)} · max ${fmtMs(metrics.browser_long_task_max_ms)}</strong></div>
    <div class="cx-detail-stat"><span>Transferred resources</span><strong>${Number(metrics.browser_resource_count||0)} · ${fmtBytes(metrics.browser_transfer_bytes)}</strong></div>
    <div class="cx-detail-stat"><span>Supabase transport</span><strong>${Number(metrics.rest_request_count||0)} req · ${fmtBytes(metrics.rest_transfer_bytes)}</strong><small>${Number(metrics.rest_error_count||0)} transport errors</small></div>
    <div class="cx-detail-stat"><span>Timeout retries</span><strong>${retries}</strong></div>
    <div class="cx-detail-stat"><span>Recovered retries</span><strong>${recoveries}</strong></div>
    <div class="cx-detail-stat"><span>Retry failures</span><strong>${failures}</strong></div>
    <div class="cx-detail-stat"><span>Slow reads (&gt;4s)</span><strong>${Number(metrics.slow_reads||0)}</strong></div>
    <div class="cx-detail-stat"><span>Last lazy page</span><strong>${metrics.last_lazy_page?`${metrics.last_lazy_page} · ${fmtMs(metrics.last_lazy_page_ms)}`:'—'}</strong></div>
  </div><div class="cx-section-title" style="margin-top:14px">Supabase endpoint cost</div>${endpointStatsHtml(metrics)}<div class="cx-sub">Ranked by total HTTP time in this browser session. Endpoint names are normalized; query strings, card IDs, and user identifiers are not stored. No extra API calls are generated by this card.${metrics.last_retry_path?` Last timeout path: ${clean(metrics.last_retry_path)}`:''}</div>`;
}

export function installRuntimeHealth(){
  observePerformance();
  document.addEventListener('collectish:scout-v5-ready',()=>{const metrics=readMetrics();if(metrics.scout_first_load_ms==null)writeMetrics({scout_first_load_ms:Math.round(performance.now()-started),scout_ready_at:new Date().toISOString()})});
  document.addEventListener('collectish:lazy-page-loaded',event=>{writeMetrics({last_lazy_page:event.detail?.page||null,last_lazy_page_ms:event.detail?.ms??null});if(document.getElementById('cxAdmin')?.classList.contains('active'))renderRuntimeHealth()});
  document.addEventListener('collectish:runtime-health',()=>{if(document.getElementById('cxAdmin')?.classList.contains('active'))renderRuntimeHealth()});
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-cx-page="admin"]'))setTimeout(renderRuntimeHealth,120)},true);
  window.CollectishRuntimeHealthCard={render:renderRuntimeHealth,get:readMetrics};
}

installRuntimeHealth();
