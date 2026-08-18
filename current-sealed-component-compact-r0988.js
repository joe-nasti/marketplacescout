// Compact mobile labels for sealed component economics table.
(() => {
  const labels=['TCGL','L+S','TCGM','CKR','MP','MKM','CKBL','TCGD'];
  const titles=['TCG Low','TCG Low + shipping','TCG Market','Card Kingdom retail','ManaPool retail','Cardmarket retail','Card Kingdom buylist','TCG Direct net'];
  function run(){
    document.querySelectorAll('.cx-sealed-econ').forEach(table=>{
      if(table.dataset.compactLabels==='1')return;
      const hs=table.querySelectorAll('thead tr:nth-child(2) th');
      hs.forEach((h,i)=>{if(labels[i]){h.textContent=labels[i];h.title=titles[i]}});
      table.querySelectorAll('tbody tr').forEach(tr=>{
        const tds=tr.querySelectorAll('td');if(tds.length<3)return;
        const name=tds[0],qty=(tds[1].textContent||'').trim(),finish=(tds[2].textContent||'').trim();
        const small=name.querySelector('small');if(small&&!small.dataset.compactMeta){small.dataset.compactMeta='1';small.textContent=`${small.textContent} · ×${qty}${finish?` · ${finish}`:''}`}
      });
      const total=table.querySelector('tfoot th:first-child');if(total)total.textContent='Totals';
      table.dataset.compactLabels='1';
    });
  }
  const mo=new MutationObserver(()=>requestAnimationFrame(run));
  document.addEventListener('collectish:ready',()=>{mo.observe(document.documentElement,{childList:true,subtree:true});run()});
  if(document.readyState!=='loading'){mo.observe(document.documentElement,{childList:true,subtree:true});run()}
})();
