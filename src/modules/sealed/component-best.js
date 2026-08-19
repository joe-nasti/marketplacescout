// Scout Sealed component economics: best retail / best exit highlighting.
(() => {
  const moneyNum=s=>{const m=String(s||'').replace(/,/g,'').match(/-?\$?([0-9]+(?:\.[0-9]+)?)/);return m?Number(m[1]):null};
  const retailCols=[4,5,7,8,9],exitCols=[10,11]; // 1-based table columns; TCGM (6) is reference only.
  function best(cells,cols,mode){const vals=cols.map(i=>({cell:cells[i-1],v:moneyNum(cells[i-1]?.textContent)})).filter(x=>x.cell&&Number.isFinite(x.v)&&x.v>0);if(!vals.length)return;const target=mode==='min'?Math.min(...vals.map(x=>x.v)):Math.max(...vals.map(x=>x.v));vals.filter(x=>Math.abs(x.v-target)<.005).forEach(x=>x.cell.classList.add(mode==='min'?'cx-econ-best-retail':'cx-econ-best-exit'))}
  function decorate(table){if(!table||table.dataset.cxBestPrices==='1')return;table.querySelectorAll('tbody tr').forEach(tr=>{const cells=[...tr.children];best(cells,retailCols,'min');best(cells,exitCols,'max')});const foot=table.querySelector('tfoot tr');if(foot){const cells=[...foot.children];best(cells,retailCols,'min');best(cells,exitCols,'max')}table.dataset.cxBestPrices='1';const wrap=table.closest('.cx-sealed-econ-wrap');if(wrap&&!wrap.previousElementSibling?.classList?.contains('cx-econ-legend')){const d=document.createElement('div');d.className='cx-econ-legend';d.innerHTML='<span class="retail">RETAIL / ACQUIRE</span><span class="reference">TCGM = MARKET REF</span><span class="exit">EXIT / SELL</span>';wrap.before(d)}}
  function run(){document.querySelectorAll('.cx-sealed-econ').forEach(decorate)}
  const mo=new MutationObserver(()=>requestAnimationFrame(run));
  function install(){mo.observe(document.documentElement,{childList:true,subtree:true});run()}
  document.addEventListener('collectish:ready',install,{once:true});if(document.readyState!=='loading')install();
})();