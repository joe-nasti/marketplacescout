// Fail open to the legacy dashboard if the new product shell does not initialize.
(() => {
  const recover=()=>{
    const app=document.getElementById('app');
    if(!app||app.hidden)return;
    const shell=document.getElementById('collectishUxShell');
    if(shell)return;
    [...app.children].forEach(n=>n.classList.remove('collectish-legacy-surface'));
    document.body.style.background='#f3f5f8';
    if(!document.getElementById('collectishUxRecoveryNotice')){
      const notice=document.createElement('div');
      notice.id='collectishUxRecoveryNotice';
      notice.style.cssText='margin:12px;padding:10px 12px;border-radius:10px;background:#fff3cd;color:#7a5200;border:1px solid #f0d98a;font:600 13px system-ui';
      notice.textContent='Collectish loaded in recovery mode while the new dashboard initializes.';
      app.insertBefore(notice,app.firstChild);
    }
  };
  setTimeout(recover,2500);
  setTimeout(recover,6000);
})();
