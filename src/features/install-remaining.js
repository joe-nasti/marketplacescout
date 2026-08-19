// Transitional feature loader: every remaining legacy feature is now loaded as a real
// ES module in deterministic order. No ?raw source execution or classic-script runner.
const featureLoaders = [
  ()=>import('../../current-scout-volatility-overlay-r0983.js'),
  ()=>import('../../current-scout-detail-tile-links-r0986.js'),
  ()=>import('../../current-sealed-component-best-r0992.js'),
  ()=>import('../../current-sealed-detail-source-anchors-r0997.js'),
  ()=>import('../../current-sealed-summary-actions-r1000.js'),
  ()=>import('../../current-sealed-summary-tcg-r1001.js'),
  ()=>import('../../current-sealed-detail-freshness-r1002.js'),
  ()=>import('../../current-sealed-language-confidence-r1003.js'),
  ()=>import('../../current-scout-list-images.js'),
  ()=>import('../../current-scout-noise-filter.js'),
  ()=>import('../../current-scout-global-search.js'),
  ()=>import('../../current-scout-global-vendor.js'),
  ()=>import('../../current-scout-tcg-price-semantics.js'),
  ()=>import('../../current-mobile-detail-swipe.js'),
  ()=>import('../../current-inventory-v2.js'),
  ()=>import('../../current-admin-scans.js'),
  ()=>import('../../current-admin-fixed-nav.js'),
  ()=>import('../../current-admin-marketplace-health.js'),
  ()=>import('../../current-admin-console.js'),
  ()=>import('../../current-admin-sealed-catalog-r0973.js'),
  ()=>import('../../current-admin-sealed-health.js'),
  ()=>import('../../current-admin-top.js'),
  ()=>import('../../current-ask-collectish.js'),
  ()=>import('../../current-ask-investigate-presentation.js'),
  ()=>import('../../current-ask-concise-view.js'),
  ()=>import('../../current-ask-collectish-v3-investigate-safe.js'),
  ()=>import('../../current-ask-collectish-v3-actions-safe.js'),
  ()=>import('../../current-ask-collectish-v3-admin-safe.js')
];

let installPromise=null;

export function installRemainingFeatures(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    for(const load of featureLoaders)await load();
    document.dispatchEvent(new CustomEvent('collectish:feature-modules-ready'));
  })();
  return installPromise;
}
