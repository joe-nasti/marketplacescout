// Collectish Scout detail tile links — turn source-backed stat tiles into full-tile external links.
(() => {
  const detail=()=>document.getElementById('cxParityDetail');
  const norm=s=>String(s||'').trim().toLowerCase();
  const linkMap=h=>{
    const m=new Map();
    h.querySelectorAll('.cx-v5-links a').forEach(a=>{
      const t=norm(a.textContent.replace(/↗/g,''));
      if(t.includes('tcgplayer'))m.set('tcg',a.href);
      else if(t==='card kingdom')m.set('ck',a.href);
      else if(t.includes('ck buylist'))m.set('ckbuy',a.href);
      else if(t.includes('mana pool'))m.set('mana',a.href);
      else if(t.includes('cardmarket'))m.set('mkm',a.href);
      else if(t.includes('edhrec'))m.set('edh',a.href);
      else if(t.includes('scryfall'))m.set('scry',a.href);
    });
    return m;
  };
  function sourceFor(label){
    const x=norm(label);
    if(x==='tcg market'||x==='tcg low'||x==='tcg direct low')return 'tcg';
    if(x==='card kingdom')return 'ck';
    if(x==='ck cash buylist')return 'ckbuy';
    if(x==='mana pool')return 'mana';
    if(x==='cardmarket / mkm'||x==='cardmarket')return 'mkm';
    if(x==='edhrec rank')return 'edh';
    return null;
  }
  function activate(el,href){
    if(!href||el.dataset.cxTileLinked==='1')return;
    el.dataset.cxTileLinked='1';el.classList.add('cx-v5-stat-link');
    el.setAttribute('role','link');el.setAttribute('tabindex','0');
    el.setAttribute('aria-label',`${el.querySelector('span')?.textContent||'Open source'} — open source`);
    const go=()=>window.open(href,'_blank','noopener');
    el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();go()});
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
  }
  function run(){
    const h=detail();if(!h)return;const links=linkMap(h);if(!links.size)return;
    h.querySelectorAll('.cx-v5-stat').forEach(el=>{const src=sourceFor(el.querySelector(':scope > span')?.textContent);if(src)activate(el,links.get(src))});
    // Best-trade boxes use a different structure, but TCG Direct is source-backed too.
    h.querySelectorAll('.cx-v5-callout > div').forEach(el=>{const label=norm(el.querySelector('span')?.textContent);if(label==='tcg direct low')activate(el,links.get('tcg'))});
  }
  const mo=new MutationObserver(()=>requestAnimationFrame(run));
  function install(){const h=detail();if(!h)return;mo.observe(h,{childList:true,subtree:true});run()}
  document.addEventListener('collectish:ready',()=>setTimeout(install,0));
  document.addEventListener('collectish:scout-v5-ready',()=>setTimeout(install,0));
  if(detail())install();
})();
