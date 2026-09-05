import { spawn } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pageUrl=process.env.PAGE_URL||process.argv[2];
const chrome=process.env.CHROME||process.argv[3];
const out=process.env.PERF_OUT||'/tmp/live-performance.json';
const configuredPort=Number(process.env.CDP_PORT||9222);
if(!pageUrl||!chrome)throw new Error('PAGE_URL and CHROME are required');
if(!Number.isInteger(configuredPort)||configuredPort<1024||configuredPort>65535)throw new Error('CDP_PORT must be an integer between 1024 and 65535');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const userData=await mkdtemp(join(tmpdir(),'collectish-cdp-'));
let port=configuredPort;
const child=spawn(chrome,[
  '--headless=new','--no-sandbox','--disable-gpu',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${userData}`,'--disable-background-networking','--disable-component-update',
  '--disable-default-apps','--no-first-run','about:blank'
],{stdio:['ignore','ignore','pipe']});
let stderr='';child.stderr.on('data',d=>stderr+=String(d));

async function resolveDebugPort(){
  for(let i=0;i<120;i++){
    if(child.exitCode!==null)break;
    try{
      const res=await fetch(`http://127.0.0.1:${port}/json/version`);
      if(res.ok)return port;
    }catch{}
    await sleep(100);
  }
  throw new Error(`Chrome DevTools port unavailable on ${port} (exit=${child.exitCode??'running'}): ${stderr.slice(-2000)}`);
}

async function json(path,options){
  if(!port)throw new Error('Chrome DevTools port not resolved');
  const res=await fetch(`http://127.0.0.1:${port}${path}`,options);
  if(!res.ok)throw new Error(`CDP HTTP ${res.status}`);
  return res.json();
}

try{
  port=await resolveDebugPort();
  let targets=[];
  for(let i=0;i<80;i++){
    try{targets=await json('/json/list');if(targets.length)break}catch{}
    await sleep(100);
  }
  const target=targets.find(x=>x.type==='page')||targets[0];
  if(!target?.webSocketDebuggerUrl)throw new Error(`Chrome CDP target unavailable on port ${port}: ${stderr.slice(-2000)}`);

  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  let seq=0;const pending=new Map();const listeners=new Map();
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result);return}
    const handlers=listeners.get(msg.method)||[];for(const fn of handlers)fn(msg.params||{});
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  const once=method=>new Promise(resolve=>{const fn=params=>{listeners.set(method,(listeners.get(method)||[]).filter(x=>x!==fn));resolve(params)};listeners.set(method,[...(listeners.get(method)||[]),fn])});

  let requestCount=0,transferBytes=0,failedRequests=0;
  listeners.set('Network.requestWillBeSent',[()=>requestCount++]);
  listeners.set('Network.loadingFinished',[p=>transferBytes+=Number(p.encodedDataLength||0)]);
  listeners.set('Network.loadingFailed',[()=>failedRequests++]);

  await Promise.all([send('Page.enable'),send('Network.enable'),send('Runtime.enable'),send('Performance.enable')]);
  const url=new URL(pageUrl);url.searchParams.set('livePerf',Date.now());
  const loaded=once('Page.loadEventFired');
  await send('Page.navigate',{url:url.href});
  await Promise.race([loaded,sleep(15000)]);
  await sleep(1500);

  const navEval=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const n=performance.getEntriesByType('navigation')[0];const paints=performance.getEntriesByType('paint');const fcp=paints.find(x=>x.name==='first-contentful-paint');const resources=performance.getEntriesByType('resource');return {href:location.href,title:document.title,readyState:document.readyState,ttfb:n?Math.round(n.responseStart):null,domContentLoaded:n?Math.round(n.domContentLoadedEventEnd):null,load:n?Math.round(n.loadEventEnd):null,fcp:fcp?Math.round(fcp.startTime):null,resourceCount:resources.length,resourceTransferBytes:Math.round(resources.reduce((a,r)=>a+Number(r.transferSize||0),0)),jsResources:resources.filter(r=>/\\.js(?:$|\\?)/.test(r.name)).length,cssResources:resources.filter(r=>/\\.css(?:$|\\?)/.test(r.name)).length,images:resources.filter(r=>r.initiatorType==='img').length,domNodes:document.getElementsByTagName('*').length,shellOk:!!document.querySelector('.collectish-product-shell,.cx-auth-card,#modernSignIn')};})()`});
  const browser=navEval.result.value||{};
  const perf=await send('Performance.getMetrics');
  const metricMap=Object.fromEntries((perf.metrics||[]).map(x=>[x.name,x.value]));
  const report={
    measuredAt:new Date().toISOString(),url:url.href,
    navigation:{ttfbMs:browser.ttfb,fcpMs:browser.fcp,domContentLoadedMs:browser.domContentLoaded,loadMs:browser.load},
    network:{requestCount,failedRequests,encodedTransferBytes:Math.round(transferBytes),resourceTransferBytes:browser.resourceTransferBytes,resourceCount:browser.resourceCount,jsResources:browser.jsResources,cssResources:browser.cssResources,images:browser.images},
    runtime:{domNodes:browser.domNodes,taskDurationMs:Math.round(Number(metricMap.TaskDuration||0)*1000),scriptDurationMs:Math.round(Number(metricMap.ScriptDuration||0)*1000),layoutDurationMs:Math.round(Number(metricMap.LayoutDuration||0)*1000),recalcStyleDurationMs:Math.round(Number(metricMap.RecalcStyleDuration||0)*1000),jsHeapUsedBytes:Math.round(Number(metricMap.JSHeapUsedSize||0))},
    shellOk:browser.shellOk===true
  };
  report.budgets={
    shellOk:report.shellOk,
    ttfb:report.navigation.ttfbMs==null||report.navigation.ttfbMs<3000,
    fcp:report.navigation.fcpMs==null||report.navigation.fcpMs<5000,
    load:report.navigation.loadMs==null||report.navigation.loadMs<8000,
    transfer:report.network.encodedTransferBytes<5_000_000,
    requests:report.network.requestCount<120,
    taskDuration:report.runtime.taskDurationMs<3000,
    failedRequests:report.network.failedRequests<5
  };
  report.pass=Object.values(report.budgets).every(Boolean);
  await writeFile(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(process.env.GITHUB_STEP_SUMMARY){
    const fs=await import('node:fs/promises');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`\n### Live Collectish performance\n- TTFB: ${report.navigation.ttfbMs??'—'} ms\n- FCP: ${report.navigation.fcpMs??'—'} ms\n- Load: ${report.navigation.loadMs??'—'} ms\n- Requests: ${report.network.requestCount}\n- Encoded transfer: ${(report.network.encodedTransferBytes/1024).toFixed(0)} KiB\n- Task duration: ${report.runtime.taskDurationMs} ms\n- Script: ${report.runtime.scriptDurationMs} ms\n- Layout: ${report.runtime.layoutDurationMs} ms\n- DOM nodes: ${report.runtime.domNodes}\n- Result: ${report.pass?'PASS':'FAIL'}\n`);
  }
  if(!report.pass)process.exitCode=1;
  ws.close();
} finally {
  child.kill('SIGTERM');
}
