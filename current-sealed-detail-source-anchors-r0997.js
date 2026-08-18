// Scout Sealed source anchors r0997 — native anchors matching Scout external-link behavior.
(() => {
  const cache=new Map();
  const slug=s=>String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
  const selectedUuid=()=>document.querySelector('#cxSealedRows [data-deck].selected')?.dataset?.deck||null;
  const tcg=(c,direct=false)=>c?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(c.product_id)}?Printing=${encodeURIComponent(String(c.finish||'normal').toLowerCase()==='foil'?'Foil':'Normal')}&Condition=Near+Mint&Language=English${direct?'&direct=true':''}&page=1`:'';
  const scry=c=>c?.set_code&&c?.collector_number?`https://scryfall.com/card/${encodeURIComponent(String(c.set_code).toLowerCase())}/${encodeURIComponent(c.collector_number)}`:'';
  const ck=c=>c?.card_name?`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(c.card_name)}&filter%5Btab%5D=mtg_card`:'';
  const ckBuy=c=>c?.card_name?`https://www.cardkingdom.com/purchasing/mtg_singles?search=header&filter%5Bname%5D=${encodeURIComponent(c.card_name)}`:'';
  const mana=c=>{const n=slug(c?.card_name),s=String(c?.set_code||'').toLowerCase(),cn=encodeURIComponent(c?.collector_number||'');return n?(s&&cn?`https://manapool.com/card/${encodeURIComponent(s)}/${cn}/${n}`:`https://manapool.com/card/${n}`):''};
  const mkm=c=>c?.card_name?`https://www.cardmarket.com/en/Magic/Cards/${slug(c.card_name)}`:'';
  const shown=el=>el&&el.textContent.trim()&&el.textContent.trim()!=='—';

  function wrap(el,url,title,{always=false}={}){
    if(!el||!url||el.dataset.cxAnchorLinked==='1')return;
    if(!always&&!shown(el))return;
    const a=document.createElement('a');
    a.href=url;
    a.target='_blank';
    a.rel='noopener';
    a.className='cx-source-anchor';
    a.title=title||'Open source';
    a.dataset.noDetailSwipe='1';
    while(el.firstChild)a.appendChild(el.firstChild);
    el.appendChild(a);el.dataset.cxAnchorLinked='1';
    // Match Scout: a real target=_blank anchor. Stop sheet/card handlers but do not prevent default navigation.
    a.addEventListener('click',e=>e.stopPropagation());
    a.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
  }
  function jump(el,target,title){
    if(!el||el.dataset.cxAnchorLinked==='1'||!target)return;
    const a=document.createElement('a');a.href='#';a.className='cx-source-anchor cx-source-anchor-internal';a.title=title||'View component economics';
    while(el.firstChild)a.appendChild(el.firstChild);el.appendChild(a);el.dataset.cxAnchorLinked='1';
    a.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();target.scrollIntoView({behavior:'smooth',block:'start'})});
  }
  async function load(uuid){
    if(cache.has(uuid))return cache.get(uuid);
    const p=(async()=>{
      const [cards,price]=await Promise.all([
        rest('rpc/get_sealed_component_economics',{method:'POST',body:{p_sealed_uuid:uuid}}).catch(()=>[]),
        rest(`sealed_product_price_current?select=product_id,product_name&source=eq.tcgplayer_public&sealed_uuid=eq.${encodeURIComponent(uuid)}&limit=1`).catch(()=>[])
      ]);
      return {cards:cards||[],price:(price||[])[0]||null};
    })();cache.set(uuid,p);return p;
  }
  async function decorate(){
    const d=document.getElementById('cxSealedDetail'),uuid=selectedUuid();
    if(!d||!uuid||!d.querySelector('.cx-sealed-econ'))return;
    const {cards,price}=await load(uuid);if(selectedUuid()!==uuid)return;
    const sealedUrl=price?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(price.product_id)}?page=1`:'';
    wrap(d.querySelector('h3'),sealedUrl,'Open sealed product on TCGplayer',{always:true});
    const econTitle=d.querySelector('.cx-sealed-econ-title');
    [...d.querySelectorAll('.cx-sealed-stat')].forEach(s=>{
      const label=(s.querySelector('span')?.textContent||'').trim().toLowerCase();
      if(label==='sealed acquisition')wrap(s,sealedUrl,'Open sealed product on TCGplayer',{always:true});
      else if(['tcg market ev','ck buylist floor','market spread','components'].includes(label))jump(s,econTitle,'View component economics');
    });
    const trs=[...d.querySelectorAll('.cx-sealed-econ tbody tr')];
    trs.forEach((tr,i)=>{
      const c=cards[i];if(!c)return;const td=tr.querySelectorAll('td');if(td.length<11)return;
      wrap(td[0],scry(c),'Open exact printing on Scryfall',{always:true});
      [3,4,5].forEach(ix=>wrap(td[ix],tcg(c,false),'Open exact TCGplayer printing'));
      wrap(td[6],ck(c),'Open Card Kingdom retail');
      wrap(td[7],mana(c),'Open ManaPool card page');
      wrap(td[8],mkm(c),'Open Cardmarket card page');
      wrap(td[9],ckBuy(c),'Open Card Kingdom buylist');
      wrap(td[10],tcg(c,true),'Open exact TCGplayer Direct printing');
    });
  }
  let raf=0;const schedule=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>decorate().catch(()=>{}))};
  const mo=new MutationObserver(schedule);
  function install(){
    mo.observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('click',e=>{if(e.target.closest('#cxSealedRows [data-deck]'))setTimeout(schedule,80)},true);
    document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='sealed')setTimeout(schedule,40)});
    schedule();
  }
  document.addEventListener('collectish:ready',install,{once:true});if(document.readyState!=='loading')install();
})();