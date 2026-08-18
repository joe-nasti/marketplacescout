// Fix Scout Sealed mobile component table header alignment.
(() => {
  const labels=['Card','TCGL','L+S','TCGM','CKR','MP','MKM','CKBL','TCGD'];
  const titles=['Card','TCG Low','TCG Low + shipping','TCG Market','Card Kingdom retail','ManaPool retail','Cardmarket retail','Card Kingdom buylist','TCG Direct net'];
  function normalize(table){
    if(!table||table.dataset.cxMobileHeader990==='1')return;
    const thead=table.querySelector('thead');if(!thead)return;
    thead.innerHTML=`<tr>${labels.map((x,i)=>`<th${i===0?' class="sticky-name"':''} title="${titles[i]}">${x}</th>`).join('')}</tr>`;
    table.dataset.cxMobileHeader990='1';
  }
  function run(){document.querySelectorAll('.cx-sealed-econ').forEach(normalize)}
  const mo=new MutationObserver(()=>requestAnimationFrame(run));
  function install(){mo.observe(document.documentElement,{childList:true,subtree:true});run()}
  document.addEventListener('collectish:ready',install,{once:true});
  if(document.readyState!=='loading')install();
})();
