const STYLE_ID='cx-seller-sync-progress-style';

export function installSellerSyncProgressStyle(){
  if(document.getElementById(STYLE_ID))return;
  const style=document.createElement('style');
  style.id=STYLE_ID;
  style.textContent=`
    .cx-seller-sync-progress{margin-top:8px;max-width:560px;font-size:12px;color:var(--muted,#8f9aaa)}
    .cx-seller-sync-progress[hidden]{display:none!important}
    .cx-seller-sync-progress-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:5px}
    .cx-seller-sync-progress-label{font-weight:700;color:var(--text,#e8edf4)}
    .cx-seller-sync-progress-pct{font-variant-numeric:tabular-nums}
    .cx-seller-sync-progress-track{height:7px;width:100%;overflow:hidden;border-radius:999px;background:rgba(127,140,160,.24)}
    .cx-seller-sync-progress-fill{height:100%;width:0;border-radius:inherit;background:currentColor;transition:width .3s ease;color:var(--accent,#5da9ff)}
    .cx-seller-sync-progress-detail{margin-top:5px;line-height:1.3}
  `;
  document.head.append(style);
}

installSellerSyncProgressStyle();
