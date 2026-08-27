import { loadDiscovery,renderDiscovery,setDiscoveryFilter,setDiscoveryQuery } from './discovery-view.js';

let installed=false,active=false;
function signalsHost(){return document.getElementById('cxSignals')}
function discoveryHost(){return document.getElementById('cxSignalsDiscovery')}
function ensureSurface(){
  const host=signalsHost(),nav=document.getElementById('cxSignalsNav');if(!host||!nav)return false;
  if(!nav.querySelector('[data-discovery-mode]')){
    const b=document.createElement('button');b.type='button';b.dataset.discoveryMode='1';b.textContent='Discovery';b.title='Externally surfaced cards to triage with Scout';
    const sources=nav.querySelector('[data-signals-mode="sources"]');nav.insertBefore(b,sources||null);
  }
  if(!discoveryHost()){
    const section=document.createElement('section');section.id='cxSignalsDiscovery';section.className='cx-discovery-surface';section.hidden=true;
    const scan=document.getElementById('cxSignalsScan');if(scan?.parentNode)scan.parentNode.insertBefore(section,scan.nextSibling);else host.appendChild(section);
  }
  return true;
}
function showDiscovery(){
  if(!ensureSurface())return;active=true;
  const scan=document.getElementById('cxSignalsScan'),workspace=document.getElementById('cxSignalsWorkspace'),surface=discoveryHost();
  if(scan)scan.hidden=true;if(workspace)workspace.hidden=true;if(surface)surface.hidden=false;
  document.querySelectorAll('#cxSignalsNav button').forEach(b=>b.classList.toggle('active',!!b.dataset.discoveryMode));
  if(surface)surface.innerHTML='<div class="cx-empty">Loading discovery candidates…</div>';
  void loadDiscovery().then(()=>renderDiscovery(surface)).catch(error=>{if(surface)surface.innerHTML=`<div class="cx-empty">Could not load discovery candidates: ${String(error?.message||error)}</div>`});
}
function leaveDiscovery(){active=false;const surface=discoveryHost();if(surface)surface.hidden=true}
function openScout(el){document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:{sku_id:el.dataset.sku||null,product_id:el.dataset.product||null,scryfall_id:el.dataset.scryfall||null,card_name:el.dataset.card||null}}))}
function routeClick(e){
  const discovery=e.target.closest?.('[data-discovery-mode]');if(discovery){e.preventDefault();showDiscovery();return}
  const standard=e.target.closest?.('[data-signals-mode]');if(standard&&active){leaveDiscovery();return}
  if(!active)return;
  const filter=e.target.closest?.('[data-discovery-filter]');if(filter){e.preventDefault();setDiscoveryFilter(filter.dataset.discoveryFilter);renderDiscovery(discoveryHost());return}
  const row=e.target.closest?.('[data-discovery-open]');if(row){e.preventDefault();openScout(row)}
}
function routeInput(e){if(!active||e.target?.id!=='cxDiscoverySearch')return;const pos=e.target.selectionStart;setDiscoveryQuery(e.target.value);renderDiscovery(discoveryHost());const input=document.getElementById('cxDiscoverySearch');if(input){input.focus();try{input.setSelectionRange(pos,pos)}catch{}}}
function refreshIfActive(){if(!active)return;const surface=discoveryHost();if(!surface)return;surface.innerHTML='<div class="cx-empty">Refreshing discovery candidates…</div>';void loadDiscovery(true).then(()=>renderDiscovery(surface)).catch(()=>{})}
function observeSignals(){const observer=new MutationObserver(()=>ensureSurface());observer.observe(document.body,{childList:true,subtree:true});ensureSurface()}
export function installSignalsDiscovery(){if(installed)return;installed=true;document.addEventListener('click',routeClick,true);document.addEventListener('input',routeInput,true);document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(ensureSurface);else leaveDiscovery()});document.addEventListener('collectish:ready',observeSignals);document.addEventListener('collectish:intel-changed',refreshIfActive);observeSignals()}
