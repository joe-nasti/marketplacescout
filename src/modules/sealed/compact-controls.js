import store from '../../state/store.js';
import { registerComponent } from '../../core/lifecycle.js';

const BUYLIST_KEY='collectishSealedBuylistBacked';
const backed=r=>{
  const buy=Number(r?.cardkingdom_buylist_ev),acq=Number(r?.sealed_acquisition_price);
  return Number.isFinite(buy)&&buy>0&&Number.isFinite(acq)&&acq>0&&buy>acq;
};

function currentEnabled(){
  const s=store.get().sealed||{};
  if(typeof s.filters?.buylistBacked==='boolean')return s.filters.buylistBacked;
  return localStorage.getItem(BUYLIST_KEY)==='1';
}

function setEnabled(enabled){
  const s=store.get().sealed||{};
  const filters={...(s.filters||{}),buylistBacked:Boolean(enabled)};
  store.update('sealed',{filters});
  localStorage.setItem(BUYLIST_KEY,enabled?'1':'0');
}

function rowMap(){
  return new Map((store.get().sealed?.rows||[]).map(r=>[String(r.sealed_uuid),r]));
}

function applyBuylistFilter(){
  const container=document.getElementById('cxSealedRows');
  if(!container)return;
  const enabled=currentEnabled(),rows=rowMap();
  const nodes=[...container.querySelectorAll('[data-deck]')];
  for(const node of nodes){
    const row=rows.get(String(node.dataset.deck));
    node.classList.toggle('cx-sealed-buylist-hidden',enabled&&!backed(row));
  }
  const button=document.getElementById('cxSealedBuylistBacked');
  if(button){
    button.setAttribute('aria-pressed',enabled?'true':'false');
    button.classList.toggle('active',enabled);
  }
  if(!enabled)return;
  requestAnimationFrame(()=>{
    const selected=String(store.get().sealed?.selectedId||'');
    const selectedNode=nodes.find(n=>String(n.dataset.deck)===selected);
    if(selectedNode&&!selectedNode.classList.contains('cx-sealed-buylist-hidden')&&!selectedNode.hidden)return;
    const first=nodes.find(n=>!n.classList.contains('cx-sealed-buylist-hidden')&&!n.hidden)?.dataset.deck;
    if(first&&first!==selected)window.CollectishSealed?.select?.(first);
  });
}

function compactToolbar(){
  const toolbar=document.querySelector('#cxSealed .cx-sealed-toolbar');
  if(!toolbar)return;
  const search=toolbar.querySelector('#cxSealedSearch');
  const status=toolbar.querySelector('#cxSealedFilter');
  const type=toolbar.querySelector('#cxSealedSetType');
  const language=toolbar.querySelector('#cxSealedLanguagePricing');
  const count=toolbar.querySelector('#cxSealedLanguageFilterCount');
  if(!search||!status||!type||!language)return;

  toolbar.classList.add('cx-sealed-toolbar-compact');
  status.classList.add('cx-sealed-filter-internal');
  count?.classList.add('cx-sealed-filter-internal');
  const allTypes=type.querySelector('option[value=""]');
  if(allTypes)allTypes.textContent='All Types';
  const allLanguages=language.querySelector('option[value="all"]');
  if(allLanguages)allLanguages.textContent='Language';
  type.classList.add('cx-sealed-filter-chip');
  language.classList.add('cx-sealed-filter-chip');

  let bar=toolbar.querySelector('.cx-sealed-chip-bar');
  if(!bar){
    bar=document.createElement('div');
    bar.className='cx-sealed-chip-bar';
    search.insertAdjacentElement('afterend',bar);
  }
  if(type.parentElement!==bar)bar.append(type);
  if(language.parentElement!==bar)bar.append(language);

  let toggle=bar.querySelector('#cxSealedBuylistBacked');
  if(!toggle){
    toggle=document.createElement('button');
    toggle.type='button';
    toggle.id='cxSealedBuylistBacked';
    toggle.className='cx-sealed-filter-toggle';
    toggle.innerHTML='<span aria-hidden="true">⚡</span><span>Buylist Backed</span>';
    toggle.addEventListener('click',()=>{
      setEnabled(!currentEnabled());
      applyBuylistFilter();
    });
    bar.append(toggle);
  }
  applyBuylistFilter();
}

function schedule(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    compactToolbar();
    applyBuylistFilter();
  }));
}

registerComponent('sealed-compact-controls',{
  mount(){document.addEventListener('collectish:sealed-rendered',schedule)},
  unmount(){document.removeEventListener('collectish:sealed-rendered',schedule)},
  onPage(page){if(page==='sealed')schedule()}
});
