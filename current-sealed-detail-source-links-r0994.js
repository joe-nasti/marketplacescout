// Scout Sealed source-link overlay: make summary tiles and component prices actionable.
(() => {
  const cache=new Map();
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const slug=s=>String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
  const selectedUuid=()=>document.querySelector('#cxSealedRows [data-deck].selected')?.dataset?.deck||null;
  const tcg=(c,direct=false)=>c?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(c.product_id)}?Printing=${encodeURIComponent(String(c.finish||'normal').toLowerCase()==='foil'?'Foil':'Normal')}&Condition=Near+Mint&Language=English${direct?'&direct=true':''}&page=1`:'';
  const scry=c=>c?.set_code&&c?.collector_number?`https://scryfall.com/card/${encodeURIComponent(String(c.set_code).toLowerCase())}/${encodeURIComponent(c.collector_number)}`:'';
  const ck=c=>c?.card_name?`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(c.card_name)}&filter%5Btab%5D=mtg_card`:'';
  const ckBuy=c=>c?.card_name?`https://www.cardkingdom.com/purchasing/mtg_singles?search=header&filter%5Bname%5D=${encodeURIComponent(c.card_name)}`:'';
  const mana=c=>{const n=slug(c?.card_name),s=String(c?.set_code||'').toLowerCase(),cn=encodeURIComponent(c?.collector_number||'');return n?(s&&cn?`https://manapool.com/card/${encodeURIComponent(s)}/${cn}/${n}`:`https://manapool.com/card/${n}`):''};
  const mkm=c=>c?.card_name?`https://www.cardmarket.com/en/Magic/Cards/${slug(c.card_name)}`:'';
  const linkify=(el,url,title)=>{
    if(!el||!url||el.dataset.cxSourceLinked==='1')return;
    el.dataset.cxSourceLinked='1';el.classList.add('cx-source-link');el.setAttribute('role','link');el.setAttribute('tabindex','0');el.title=title||'Open source';
    const open=()=>window.open(url,'_blank','noopener');
    el.addEventListener('click',e=>{if(e.target.closest('a,button'))return;open()});
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});
  };
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
  function internalJump(el,selector,title){
    if(!el||el.dataset.cxSourceLinked==='1')return;const target=document.querySelector(selector);if(!target)return;
    el.dataset.cxSourceLinked='1';el.classList.add('cx-source-link','cx-source-internal');el.setAttribute('role','button');el.setAttribute('tabindex','0');el.title=title||'View component prices';
    const go=()=>target.scrollIntoView({behavior:'smooth',block:'start'});
    el.addEventListener('click',go);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
  }
  async function decorate(){
    const d=document.getElementById('cxSealedDetail'),uuid=selectedUuid();if(!d||!uuid||!d.querySelector('.cx-sealed-econ'))return;
    if(d.dataset.cxSourceLinksUuid===uuid)return;
    const {cards,price}=await load(uuid);if(selectedUuid()!==uuid)return;
    d.dataset.cxSourceLinksUuid=uuid;

    const sealedUrl=price?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(price.product_id)}?page=1`:'';
    linkify(d.querySelector('h3'),sealedUrl,'Open sealed product on TCGplayer');
    const stats=[...d.querySelectorAll('.cx-sealed-stat')];
    for(const s of stats){
      const label=(s.querySelector('span')?.textContent||'').trim().toLowerCase();
      if(label==='sealed acquisition')linkify(s,sealedUrl,'Open sealed product on TCGplayer');
      else if(['tcg market ev','ck buylist floor','market spread','components'].includes(label))internalJump(s,'.cx-sealed-econ-title','View component economics');
    }

    const trs=[...d.querySelectorAll('.cx-sealed-econ tbody tr')];
    trs.forEach((tr,i)=>{
      const c=cards[i];if(!c)return;const td=tr.querySelectorAll('td');if(td.length<11)return;
      linkify(td[0],scry(c),'Open exact card on Scryfall');
      [3,4,5].forEach(ix=>linkify(td[ix],tcg(c,false),'Open exact TCGplayer printing'));
      linkify(td[6],ck(c),'Open Card Kingdom retail search');
      linkify(td[7],mana(c),'Open ManaPool card page');
      linkify(td[8],mkm(c),'Open Cardmarket card page');
      linkify(td[9],ckBuy(c),'Open Card Kingdom buylist search');
      linkify(td[10],tcg(c,true),'Open exact TCGplayer Direct printing');
    });
  }
  let raf=0;const schedule=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>decorate().catch(()=>{}))};
  const mo=new MutationObserver(schedule);
  function install(){mo.observe(document.documentElement,{childList:true,subtree:true});document.addEventListener('click',e=>{if(e.target.closest('#cxSealedRows [data-deck]'))setTimeout(schedule,60)},true);schedule()}
  document.addEventListener('collectish:ready',install,{once:true});if(document.readyState!=='loading')install();
})();