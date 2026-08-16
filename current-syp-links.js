// Collectish SYP external links — zero-fetch delegated click behavior.
(() => {
  const productNameFromCell=cell=>{
    if(!cell)return '';
    for(const n of cell.childNodes){if(n.nodeType===Node.TEXT_NODE&&n.textContent.trim())return n.textContent.trim();}
    return cell.textContent.replace(/TCG\s+\d+.*/i,'').trim();
  };
  const tcgUrl=name=>`https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(name)}&view=grid`;
  const openExternal=url=>{
    try{if(window.CollectishAndroid?.openExternal){window.CollectishAndroid.openExternal(url);return}}catch{}
    window.open(url,'_blank','noopener,noreferrer');
  };
  document.addEventListener('click',e=>{
    const cell=e.target.closest?.('#cxSyp .cx-cardname');
    if(!cell)return;
    if(e.target.closest('a,button,input,select,label'))return;
    const name=productNameFromCell(cell);if(!name)return;
    e.preventDefault();openExternal(tcgUrl(name));
  },true);
  const style=document.createElement('style');
  style.textContent='#cxSyp .cx-cardname{cursor:pointer}#cxSyp .cx-cardname:hover{text-decoration:underline;text-underline-offset:2px}';
  document.head.appendChild(style);
})();
