// Collectish Scout actionability guard — visually downgrade extreme source-price outliers.
(() => {
  const num=s=>{const n=Number(String(s||'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:null};
  let timer=null;
  function cellValue(root,label){
    for(const box of root.querySelectorAll('.cx-vendor-grid>div,.cx-global-vendor-row>div')){
      const name=box.querySelector('span')?.textContent?.trim();
      if(name===label)return num(box.querySelector('strong,b')?.textContent);
    }
    return null;
  }
  function sourceValue(action){
    const t=action.querySelector('strong,b')?.textContent||'';
    const m=t.match(/Buy\s+.+?\s+\$([0-9,.]+)/i);
    return m?Number(m[1].replace(/,/g,'')):null;
  }
  function mark(action,root){
    if(!action||action.dataset.sourceGuard==='1')return;
    action.dataset.sourceGuard='1';
    const source=sourceValue(action),market=cellValue(root,'TCG Market');
    if(!(source>0)||!(market>0)||source>=market*.20)return;
    action.classList.add('verify-source');
    const badge=action.querySelector('.cx-action-badge')||action.querySelector(':scope > span');
    if(badge)badge.textContent='BUYLIST SPREAD · VERIFY SOURCE';
    const small=action.querySelector('small');
    if(small)small.textContent+=` · source is ${((1-source/market)*100).toFixed(0)}% below Market`;
  }
  function scan(){
    document.querySelectorAll('.cx-vendor-pricing').forEach(root=>mark(root.querySelector('.cx-vendor-action.backed'),root));
    document.querySelectorAll('.cx-global-vendor-finish-block').forEach(root=>mark(root.querySelector('.cx-gv-action.backed'),root));
  }
  const style=document.createElement('style');style.textContent=`
    .cx-vendor-action.verify-source,.cx-gv-action.verify-source{background:#fff3df!important;border-color:#f1c27b!important}
    .cx-vendor-action.verify-source .cx-action-badge,.cx-gv-action.verify-source>span{background:#8a4c00!important;color:#fff!important}
  `;document.head.appendChild(style);
  const kick=()=>{clearTimeout(timer);timer=setTimeout(scan,50)};
  new MutationObserver(kick).observe(document.body,{childList:true,subtree:true});
  setTimeout(scan,300);
})();
