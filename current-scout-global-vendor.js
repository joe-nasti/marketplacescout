// Collectish Scout global-search vendor enrichment — MTGJSON normalized prices.
(() => {
  const money=n=>n==null||n===''?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n)>0?'+':''}${Number(n).toFixed(1)}%`;
  const FEE_RATE=.20;
  let timer=null, running=false, lastSignature='';

  function parseMoney(s){
    const n=Number(String(s||'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(n)?n:null;
  }
  function productId(article){
    const href=article.querySelector('a[href*="tcgplayer.com/product/"]')?.href||'';
    return (href.match(/\/product\/(\d+)/)||[])[1]||'';
  }
  function meta(article){
    const s=article.querySelector('.cx-global-print-title small')?.textContent||'';
    const parts=s.split('·').map(x=>x.trim());
    return {setCode:(parts[0]||'').toUpperCase(),collector:(parts[1]||'').replace(/^#/,'').trim()};
  }
  function marketRows(article){
    const out=[];
    article.querySelectorAll('.cx-global-market>div').forEach(row=>{
      const spans=row.querySelectorAll('span'),printing=(spans[0]?.textContent||'').split('·')[0].trim();
      const market=parseMoney(row.querySelector('b')?.textContent);
      const directMatch=(spans[1]?.textContent||'').match(/Direct\s+([^·]+)/i);
      const direct=parseMoney(directMatch?.[1]||'');
      out.push({printing,finish:/foil/i.test(printing)?'foil':/etched/i.test(printing)?'etched':'normal',market,direct});
    });
    return out;
  }
  async function batches(pathPrefix,values,size=80){
    const out=[];
    for(let i=0;i<values.length;i+=size){
      const batch=values.slice(i,i+size);
      const rows=await rest(`${pathPrefix}in.(${batch.map(encodeURIComponent).join(',')})`);
      out.push(...(rows||[]));
    }
    return out;
  }
  function economics(source,direct){
    if(!(Number(source)>0)&&!(Number(direct)>0))return null;
    if(!(Number(source)>0)||!(Number(direct)>0))return null;
    const net=Number(direct)*(1-FEE_RATE),profit=net-Number(source),roi=profit/Number(source)*100;
    return {net,profit,roi};
  }
  function vendorBlock(v,marketRowsForArticle){
    const finishes=['normal','foil','etched'].filter(f=>v[f]);
    if(!finishes.length)return '<div class="cx-global-vendor-empty">No MTGJSON vendor prices for this printing.</div>';
    return finishes.map(f=>{
      const p=v[f],m=marketRowsForArticle.find(x=>x.finish===f)||marketRowsForArticle[0]||{};
      const us=[['CK',p.cardkingdom_retail],['Mana Pool',p.manapool_retail]].filter(x=>Number(x[1])>0).sort((a,b)=>Number(a[1])-Number(b[1]));
      const best=us[0]||null,disc=best&&Number(m.market)>0?(Number(m.market)-Number(best[1]))/Number(m.market)*100:null;
      const econ=best?economics(best[1],m.direct):null;
      return `<div class="cx-global-vendor-row"><div class="cx-global-vendor-finish">${f[0].toUpperCase()+f.slice(1)}</div><div><span>CK</span><b>${money(p.cardkingdom_retail)}</b></div><div><span>CK buylist</span><b>${money(p.cardkingdom_buylist)}</b></div><div><span>Mana Pool</span><b>${money(p.manapool_retail)}</b></div><div><span>MKM</span><b>${money(p.cardmarket_retail)}</b></div>${best?`<div class="cx-global-best"><span>Best US source</span><b>${best[0]} ${money(best[1])}</b><small>${disc==null?'':`${pct(disc)} vs Market`}</small></div>`:''}${econ?`<div class="cx-global-arb ${econ.roi>0?'positive':''}"><span>→ Direct net*</span><b>${money(econ.net)}</b><small>${money(econ.profit)} · ${pct(econ.roi)} ROI</small></div>`:''}</div>`;
    }).join('')+`<small class="cx-global-vendor-note">*Direct net estimate assumes 20% selling costs. Pricing from MTGJSON; availability is not guaranteed.</small>`;
  }

  async function enrich(){
    const panel=document.getElementById('cxGlobalScoutSearch');
    if(!panel||panel.hidden||running)return;
    const articles=[...panel.querySelectorAll('.cx-global-print')];if(!articles.length)return;
    const signature=articles.map(a=>`${productId(a)}|${meta(a).setCode}|${meta(a).collector}`).join(';');
    if(signature&&signature===lastSignature&&articles.every(a=>a.dataset.vendorLoaded==='1'))return;
    running=true;
    try{
      const pids=[...new Set(articles.map(productId).filter(Boolean))];if(!pids.length)return;
      const identities=await batches('mtgjson_cards?select=uuid,tcgplayer_product_id,set_code,collector_number,cardkingdom_id,cardkingdom_foil_id&tcgplayer_product_id=',pids,70);
      const byProduct=new Map();
      for(const r of identities){const k=String(r.tcgplayer_product_id||'');if(!byProduct.has(k))byProduct.set(k,[]);byProduct.get(k).push(r)}
      const resolved=new Map(),uuids=[];
      for(const a of articles){
        const pid=productId(a),m=meta(a),cand=byProduct.get(pid)||[];
        let hit=cand.find(r=>String(r.set_code||'').toUpperCase()===m.setCode&&String(r.collector_number||'')===m.collector)
          ||cand.find(r=>String(r.set_code||'').toUpperCase()===m.setCode)
          ||cand[0]||null;
        if(hit){resolved.set(a,hit);uuids.push(String(hit.uuid))}
      }
      const unique=[...new Set(uuids)];
      const prices=unique.length?await batches('mtgjson_vendor_price_pivot_current?select=mtgjson_uuid,finish,cardkingdom_retail,cardkingdom_buylist,manapool_retail,cardmarket_retail,mtgjson_tcgplayer_retail,observed_on&mtgjson_uuid=',unique,70):[];
      const byUuid=new Map();
      for(const r of prices){const k=String(r.mtgjson_uuid);if(!byUuid.has(k))byUuid.set(k,{});byUuid.get(k)[String(r.finish||'normal').toLowerCase()]=r}
      for(const a of articles){
        let h=a.querySelector('.cx-global-vendor');if(!h){h=document.createElement('div');h.className='cx-global-vendor';a.querySelector('.cx-global-print-main')?.appendChild(h)}
        const id=resolved.get(a),vals=id?byUuid.get(String(id.uuid)):null;
        h.innerHTML=id&&vals?vendorBlock(vals,marketRows(a)):'<div class="cx-global-vendor-empty">No MTGJSON vendor identity/pricing match.</div>';
        a.dataset.vendorLoaded='1';
      }
      lastSignature=signature;
    }catch(e){console.warn('Global Scout vendor enrichment failed',e)}finally{running=false}
  }

  const style=document.createElement('style');style.textContent=`
    .cx-global-vendor{margin-top:10px;border-top:1px solid var(--cx-line);padding-top:9px}.cx-global-vendor-row{display:grid;grid-template-columns:72px repeat(4,minmax(72px,1fr)) minmax(120px,1.35fr) minmax(110px,1.2fr);gap:7px;align-items:stretch}.cx-global-vendor-row>div{border:1px solid var(--cx-line);border-radius:9px;padding:7px;background:var(--cx-bg)}.cx-global-vendor-row span,.cx-global-vendor-row small{display:block;font-size:9px;color:var(--cx-muted)}.cx-global-vendor-row b{display:block;font-size:12px;margin-top:2px}.cx-global-vendor-finish{font-weight:900;display:flex;align-items:center}.cx-global-best b{font-size:11px}.cx-global-arb.positive{background:#e8f7ee}.cx-global-arb.positive b{color:#16713a}.cx-global-vendor-note,.cx-global-vendor-empty{display:block;margin-top:6px;color:var(--cx-muted);font-size:9px}
    @media(max-width:760px){.cx-global-vendor-row{grid-template-columns:repeat(2,minmax(0,1fr));}.cx-global-vendor-finish{grid-column:1/-1}.cx-global-best,.cx-global-arb{grid-column:auto}}
  `;document.head.appendChild(style);
  const kick=()=>{clearTimeout(timer);timer=setTimeout(enrich,80)};
  const mo=new MutationObserver(kick);mo.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click',e=>{if(e.target.closest('[data-global-card],#cxGlobalScoutSearch'))setTimeout(kick,100)},true);
  setTimeout(kick,500);
})();