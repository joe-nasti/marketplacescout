import store from '../../state/store.js';
import { registerComponent } from '../../core/lifecycle.js';

function ageLabel(value){
  if(!value)return 'refresh time unavailable';
  const ms=Math.max(0,Date.now()-new Date(value).getTime());
  const minutes=Math.floor(ms/60000);
  if(minutes<1)return 'just now';
  if(minutes<60)return `${minutes}m ago`;
  const hours=Math.floor(minutes/60);
  if(hours<24)return `${hours}h ago`;
  return `${Math.floor(hours/24)}d ago`;
}

function render(){
  const host=document.getElementById('cxSyp');
  const head=host?.querySelector('.cx-page-head > div');
  if(!head)return;
  const refreshedAt=store.get().syp?.stats?.refreshed_at||null;
  let line=head.querySelector('#cxSypFreshness');
  if(!line){
    line=document.createElement('small');
    line.id='cxSypFreshness';
    line.className='cx-sub';
    head.append(line);
  }
  if(!refreshedAt){line.textContent='SYP refresh time unavailable';return}
  const absolute=new Date(refreshedAt).toLocaleString([],{
    month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'
  });
  line.textContent=`SYP data refreshed ${absolute} · ${ageLabel(refreshedAt)}`;
}

function onRendered(){render()}
registerComponent('syp-header-freshness',{
  mount(){document.addEventListener('collectish:syp-rendered',onRendered)},
  unmount(){document.removeEventListener('collectish:syp-rendered',onRendered)},
  onPage(page){if(page==='syp')render()}
});
