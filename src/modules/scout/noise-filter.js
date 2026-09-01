import { rest } from '../../core/rest.js';
import { loadResource } from '../../state/resources.js';
import { registerComponent } from '../../core/lifecycle.js';

const LOW_MARKET=2;
const STORAGE_KEY='collectishScoutHideLowMarketV2';
let meta=new Map(),queued=false;

function enabled(){try{const v=localStorage.getItem(STORAGE_KEY);return v==null?true:v!=='false'}catch{return true}}
function setEnabled(v){try{localStorage.setItem(STORAGE_KEY,v?'true':'false')}catch{}}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function isSurging(r){if(!r)return false;const edh=r.demand_sources?.edhrec||{},adjustment=n(r.demand_adjustment);if(adjustment>=5)return true;const deck=n(edh.deckChangePct),commanderDeck=n(edh.commanderDeckChangePct),rank=n(edh.rankChange),commanderRank=n(edh.commanderRankChange);if(deck>=.25||commanderDeck>=.25)return true;if((rank>=250||commanderRank>=250)&&adjustment>0)return true;const signal=String(r.demand_signal||'').toLowerCase();return adjustment>0&&(signal.includes('surging')||signal.includes('breakout')||signal.includes('accelerating'))}
async function loadMeta(force=false){const rows=await loadResource('scout.noise-meta',()=>rest('scout_opportunities_24h?select=sku_id,sku_market_price,demand_signal,demand_signal_score,demand_sources,demand_adjustment&order=opportunity_score.desc,observation_count.desc&limit=1000'),{force,ttl:60000});meta=new Map((rows||[]).map(r=>[String(r.sku_id||''),r]));schedule()}
function marketFromCard(card){const metric=[...card.querySelectorAll('.cx-scout-card-metrics span')].find(x=>/^Market\b/i.test(x.textContent||'')),m=(metric?.textContent||'').match(/\$([0-9,.]+)/);return m?Number(m[1].replace(/,/g,'')):NaN}
function ensureUi(){const page=document.getElementById('cxScout'),toolbar=page?.querySelector('.cx-scout-toolbar');if(!page||!toolbar)return null;let wrap=page.querySelector('.cx-scout-noise-filter');if(!wrap){wrap=document.createElement('div');wrap.className='cx-scout-noise-filter';wrap.innerHTML=`<label><input type="checkbox" id="cxScoutHideLowMarket"> <span>Hide Market &lt; $${LOW_MARKET.toFixed(0)} unless demand is surging</span></label><small id="cxScoutNoiseCount"></small>`;const sheet=page.querySelector('#cxScoutFilterSheetBody');if(sheet)sheet.append(wrap);else toolbar.insertAdjacentElement('afterend',wrap);const input=wrap.querySelector('#cxScoutHideLowMarket');input.addEventListener('change',()=>{setEnabled(input.checked);apply()})}const input=wrap.querySelector('#cxScoutHideLowMarket');if(input)input.checked=enabled();return wrap}
function apply(){queued=false;const host=document.getElementById('cxParityCards');if(!host)return;const wrap=ensureUi(),hide=enabled();let hidden=0,exceptions=0;for(const card of host.querySelectorAll('.cx-scout-card')){const sku=String(card.dataset.sku||''),r=meta.get(sku),dbMarket=Number(r?.sku_market_price),fallbackMarket=marketFromCard(card),market=Number.isFinite(dbMarket)?dbMarket:fallbackMarket,low=Number.isFinite(market)&&market>=0&&market<LOW_MARKET,surge=isSurging(r),shouldHide=hide&&low&&!surge;card.classList.toggle('cx-scout-low-hidden',shouldHide);card.dataset.lowMarket=low?'true':'false';card.dataset.surging=surge?'true':'false';if(shouldHide)hidden++;else if(low&&surge)exceptions++}const count=wrap?.querySelector('#cxScoutNoiseCount');if(count)count.textContent=!hide?'Showing all Market prices':`${hidden} sub-$2 ${hidden===1?'card':'cards'} hidden${exceptions?` • ${exceptions} true surge exception${exceptions===1?'':'s'}`:''}`}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply)}
function onFilter(event){if(['cxParitySearch','cxParityGrade','cxParitySet'].includes(event.target?.id))schedule()}
function onScoutReady(){ensureUi();loadMeta().catch(()=>{});schedule()}

registerComponent('scout-noise-filter',{
  mount(){document.addEventListener('collectish:scout-v5-ready',onScoutReady);document.addEventListener('input',onFilter,true);document.addEventListener('change',onFilter,true);loadMeta().catch(()=>{})},
  unmount(){document.removeEventListener('collectish:scout-v5-ready',onScoutReady);document.removeEventListener('input',onFilter,true);document.removeEventListener('change',onFilter,true)},
  onPage(page){if(page==='scout'){ensureUi();schedule()}}
});

window.CollectishScoutNoiseFilter={apply,refresh:()=>loadMeta(true)};
