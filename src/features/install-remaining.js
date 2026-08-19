// Transitional feature loader: every remaining legacy feature is now loaded as a real
// ES module in deterministic order. No ?raw source execution or classic-script runner.
const featureModules = [
  '../../current-scout-volatility-overlay-r0983.js',
  '../../current-scout-detail-tile-links-r0986.js',
  '../../current-sealed-component-best-r0992.js',
  '../../current-sealed-detail-source-anchors-r0997.js',
  '../../current-sealed-summary-actions-r1000.js',
  '../../current-sealed-summary-tcg-r1001.js',
  '../../current-sealed-detail-freshness-r1002.js',
  '../../current-sealed-language-confidence-r1003.js',
  '../../current-scout-list-images.js',
  '../../current-scout-noise-filter.js',
  '../../current-scout-global-search.js',
  '../../current-scout-global-vendor.js',
  '../../current-scout-tcg-price-semantics.js',
  '../../current-mobile-detail-swipe.js',
  '../../current-inventory-v2.js',
  '../../current-admin-scans.js',
  '../../current-admin-fixed-nav.js',
  '../../current-admin-marketplace-health.js',
  '../../current-admin-console.js',
  '../../current-admin-sealed-catalog-r0973.js',
  '../../current-admin-sealed-health.js',
  '../../current-admin-top.js',
  '../../current-ask-collectish.js',
  '../../current-ask-investigate-presentation.js',
  '../../current-ask-concise-view.js',
  '../../current-ask-collectish-v3-investigate-safe.js',
  '../../current-ask-collectish-v3-actions-safe.js',
  '../../current-ask-collectish-v3-admin-safe.js'
];

let installPromise=null;

export function installRemainingFeatures(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    for(const path of featureModules)await import(path);
    document.dispatchEvent(new CustomEvent('collectish:feature-modules-ready'));
  })();
  return installPromise;
}
