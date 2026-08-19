import { rest } from '../../core/rest.js';

let seq=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function addLink(event){
  const id=event?.detail?.id;if(!id)return;const current=++seq;
  const rows=await rest(`sealed_product_price_current?select=product_id&source=eq.cardtrader&sealed_uuid=eq.${encodeURIComponent(id)}&limit=1`).catch(()=>[]);
  if(current!==seq)return;const blueprint=(rows||[])[0]?.product_id;if(!blueprint)return;
  const bpRows=await rest(`cardtrader_blueprints?select=blueprint_id,raw_json&blueprint_id=eq.${encodeURIComponent(blueprint)}&limit=1`).catch(()=>[]);
  if(current!==seq)return;const url=(bpRows||[])[0]?.raw_json?.web_url;if(!url)return;
  let host=null;for(let i=0;i<8&&!host;i++){host=document.querySelector('#cxSealedDetail [data-cardtrader-acquire]');if(!host)await sleep(75)}
  if(current!==seq||!host)return;host.querySelector('[data-cardtrader-live-link]')?.remove();
  const a=document.createElement('a');a.dataset.cardtraderLiveLink='';a.className='cx-source-anchor';a.href=url;a.target='_blank';a.rel='noopener';a.textContent='Open live CardTrader offers ↗';
  const title=host.querySelector('.cx-section-title');if(title){title.append(' · ');title.appendChild(a)}else host.prepend(a)
}
document.addEventListener('collectish:sealed-detail-rendered',event=>{addLink(event).catch(()=>{})});
