// Collectish SYP external links — exact cached TCGplayer URL with zero-fetch search fallback.
(() => {
  const productNameFromCell=cell=>{
    if(!cell)return '';
    for(const n of cell.childNodes){if(n.nodeType===Node.TEXT_NODE&&n.textContent.trim())return n.textContent.trim();}
    return cell.textContent.replace(/TCG\s+(?:SKU\s+)?\d+.*/i,'').trim();
  };
  const searchUrl=name=>`https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(name)}&view=grid`;
  const openExternal=url=>{
    try{if(window.CollectishAndroid?.openExternalUrl){window.CollectishAndroid.openExternalUrl(url);return}}catch{}
    try{if(window.CollectishAndroid?.openExternal){window.CollectishAndroid.openExternal(url);return}}catch{}
    window.open(url,'_blank','noopener,noreferrer');
  };
  document.addEventListener('click',e=>{
    const cell=e.target.closest?.('#cxSyp .cx-cardname');
    if(!cell||e.target.closest('a,button,input,select,label'))return;
    const exact=cell.dataset.tcgUrl||'';
    const name=productNameFromCell(cell);
    const url=exact||(name?searchUrl(name):'');
    if(!url)return;
    e.preventDefault();openExternal(url);
  },true);
})();
