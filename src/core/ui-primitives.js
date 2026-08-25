let installed=false;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export const EVIDENCE_MARKERS={
  verified:{symbol:'✓',tone:'success',label:'Verified',help:'Observed or directly measured.'},
  inferred:{symbol:'~',tone:'accent',label:'Inferred',help:'Estimated or inferred; not directly observed.'},
  caution:{symbol:'!',tone:'warning',label:'Caution',help:'Useful signal, but evidence is limited.'},
  extreme:{symbol:'!!',tone:'danger',label:'Extreme',help:'Extreme or anomalous; do not assume executable.'},
  unmeasured:{symbol:'·',tone:'muted',label:'Unmeasured',help:'Not measured yet.'}
};

function markerDef(kind){return EVIDENCE_MARKERS[kind]||EVIDENCE_MARKERS.unmeasured}
export function uiEvidenceMarker(kind='unmeasured',help=''){
  const d=markerDef(kind),text=help||d.help;
  return `<button type="button" class="cx-ui-evidence ${esc(d.tone)}" data-cx-evidence-kind="${esc(kind)}" data-cx-evidence-help="${esc(text)}" aria-label="${esc(`${d.label}: ${text}`)}" title="${esc(text)}">${esc(d.symbol)}</button>`;
}
export function directPremiumEvidence(pct){
  const p=Number(pct);
  if(!Number.isFinite(p))return null;
  if(p<=25)return null;
  if(p<=75)return {kind:'inferred',help:'Direct ask premium; realized Direct sales not established.'};
  if(p<=200)return {kind:'caution',help:'Large Direct ask premium; realized Direct sales not established.'};
  return {kind:'extreme',help:'Extreme Direct ask premium; treat as unverified until realized sales support it.'};
}

function showEvidenceHelp(button){
  document.querySelector('[data-cx-evidence-popover]')?.remove();
  const kind=button.dataset.cxEvidenceKind||'unmeasured',d=markerDef(kind),help=button.dataset.cxEvidenceHelp||d.help;
  const pop=document.createElement('div');
  pop.dataset.cxEvidencePopover='1';
  pop.className='cx-ui-evidence-popover';
  pop.innerHTML=`<div><b class="cx-ui-evidence ${esc(d.tone)}">${esc(d.symbol)}</b><strong>${esc(d.label)}</strong></div><p>${esc(help)}</p><small>✓ verified · ~ inferred · ! caution · !! extreme · · unmeasured</small>`;
  document.body.appendChild(pop);
  const r=button.getBoundingClientRect(),w=Math.min(300,innerWidth-20);
  pop.style.width=`${w}px`;pop.style.left=`${Math.max(10,Math.min(innerWidth-w-10,r.left-w+26))}px`;pop.style.top=`${Math.min(innerHeight-pop.offsetHeight-10,r.bottom+8)}px`;
  const close=e=>{if(!pop.contains(e.target)&&e.target!==button){pop.remove();document.removeEventListener('pointerdown',close,true)}};
  setTimeout(()=>document.addEventListener('pointerdown',close,true),0);
}

export function installUiPrimitives(){
  if(installed)return;
  installed=true;
  const style=document.createElement('style');
  style.dataset.cxUiPrimitives='1';
  style.textContent=`
.cx-ui-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;scroll-snap-type:x proximity}.cx-ui-tabs::-webkit-scrollbar{display:none}.cx-ui-tabs>button{flex:0 0 auto;scroll-snap-align:start}
.cx-ui-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:7px}.cx-ui-metric{min-width:0;border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg-surface);padding:8px 10px;color:var(--color-text-primary)}.cx-ui-metric>span,.cx-ui-metric>small,.cx-ui-metric>em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cx-ui-metric>span,.cx-ui-metric>small{color:var(--color-text-secondary)}.cx-ui-metric>span{font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.04em}.cx-ui-metric>strong{display:block;margin-top:2px}.cx-ui-metric>small,.cx-ui-metric>em{font-size:8px;font-style:normal;margin-top:1px;color:var(--color-text-secondary)}
.cx-ui-list{overflow:hidden;border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg-surface)}
.cx-ui-status{display:inline-flex;width:max-content;max-width:100%;align-items:center;border-radius:999px;padding:2px 6px;font-size:8px;font-weight:850;line-height:1.25;text-transform:uppercase;letter-spacing:.03em}.cx-ui-status.success{background:color-mix(in srgb,var(--color-success) 14%,transparent);color:var(--color-success)}.cx-ui-status.accent{background:color-mix(in srgb,var(--color-accent) 14%,transparent);color:var(--color-accent)}.cx-ui-status.warning{background:color-mix(in srgb,var(--color-warning) 14%,transparent);color:var(--color-warning)}.cx-ui-status.danger{background:color-mix(in srgb,var(--color-danger) 14%,transparent);color:var(--color-danger)}.cx-ui-status.muted{background:color-mix(in srgb,var(--color-border) 65%,transparent);color:var(--color-text-secondary)}
.cx-ui-evidence{appearance:none;border:0;background:none;padding:0 0 0 3px;font:900 10px/1 system-ui;vertical-align:middle;cursor:pointer}.cx-ui-evidence.success{color:var(--color-success)}.cx-ui-evidence.accent{color:var(--color-accent)}.cx-ui-evidence.warning{color:var(--color-warning)}.cx-ui-evidence.danger{color:var(--color-danger)}.cx-ui-evidence.muted{color:var(--color-text-secondary)}.cx-ui-evidence-popover{position:fixed;z-index:100000;padding:10px 11px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg-surface);box-shadow:0 10px 30px rgb(0 0 0 / .28);color:var(--color-text-primary);font-size:11px}.cx-ui-evidence-popover>div{display:flex;align-items:center;gap:6px}.cx-ui-evidence-popover p{margin:6px 0}.cx-ui-evidence-popover small{color:var(--color-text-secondary);font-size:9px}
@media(max-width:700px){.cx-ui-metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.cx-ui-metric{padding:7px 8px}.cx-ui-tabs{margin-right:-12px;padding-right:12px}.cx-ui-evidence{font-size:11px;min-width:13px;min-height:13px}}
`;
  document.head.appendChild(style);
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-cx-evidence-kind]');if(b){e.preventDefault();e.stopPropagation();showEvidenceHelp(b)}});
}

export function uiMetric(label,value,sub='',extraClass=''){
  return `<div class="cx-ui-metric ${esc(extraClass)}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
}
export function uiStatus(label,tone='muted',extraClass=''){
  const allowed=new Set(['success','accent','warning','danger','muted']),safeTone=allowed.has(tone)?tone:'muted';
  return `<span class="cx-ui-status ${safeTone} ${esc(extraClass)}">${esc(label)}</span>`;
}

installUiPrimitives();
