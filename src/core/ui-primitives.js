let installed=false;

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
@media(max-width:700px){.cx-ui-metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.cx-ui-metric{padding:7px 8px}.cx-ui-tabs{margin-right:-12px;padding-right:12px}}
`;
  document.head.appendChild(style);
}

export function uiMetric(label,value,sub='',extraClass=''){
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  return `<div class="cx-ui-metric ${esc(extraClass)}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
}

export function uiStatus(label,tone='muted',extraClass=''){
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const allowed=new Set(['success','accent','warning','danger','muted']);
  const safeTone=allowed.has(tone)?tone:'muted';
  return `<span class="cx-ui-status ${safeTone} ${esc(extraClass)}">${esc(label)}</span>`;
}

installUiPrimitives();
