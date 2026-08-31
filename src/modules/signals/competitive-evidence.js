import { openCardEvidence } from './card-evidence.js';

let observer=null;

function cardNameForRow(row){return row.querySelector('span:first-child > strong')?.textContent?.trim()||''}
function enhanceRows(root=document){
  const candidates=[];
  if(root.matches?.('#cxCompetitiveIntel .cx-detail-stat:not([data-evidence-ready])'))candidates.push(root);
  root.querySelectorAll?.('#cxCompetitiveIntel .cx-detail-stat:not([data-evidence-ready])').forEach(row=>candidates.push(row));
  candidates.forEach(row=>{
    const cardName=cardNameForRow(row);if(!cardName)return;
    row.dataset.evidenceReady='1';row.classList.add('cx-competitive-evidence-row');row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`View all stored evidence for ${cardName}`);
    const action=document.createElement('button');action.type='button';action.className='cx-evidence-row-action';action.textContent='View evidence →';action.addEventListener('click',e=>{e.stopPropagation();void openCardEvidence(cardName)});row.appendChild(action);
    row.addEventListener('click',e=>{if(e.target.closest('a,button'))return;void openCardEvidence(cardName)});
    row.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button')){e.preventDefault();void openCardEvidence(cardName)}});
  });
}
function install(){
  enhanceRows();
  observer=new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes)if(n.nodeType===1)enhanceRows(n)});
  observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>enhanceRows())});
}
install();
export { openCardEvidence as openCompetitiveEvidence };
