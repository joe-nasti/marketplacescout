// Collectish Vite entrypoint.
// Vite owns hashing, CSS aggregation and chunking. Legacy files are bundled as raw
// sources and executed with classic-script semantics until each is converted to ESM.

import '../modern-core.css';
import '../current-ux.css';
import '../current-scout-parity.css';
import '../current-sealed-ev.css';
import '../current-sealed-images.css';
import '../current-sealed-scout-card-parity.css';
import '../current-sealed-metric-drilldown.css';
import '../current-sealed-score-tooltips.css';
import '../current-seller-parity.css';
import '../current-syp-parity.css';
import '../current-ask-collectish.css';
import '../current-ask-collectish-v2.css';
import '../current-ask-collectish-v3.css';
import '../current-ask-markdown-safe.css';
import '../current-ask-investigate-presentation.css';
import '../current-ask-concise-view.css';
import '../current-admin-console.css';
import '../current-theme.css';
import '../current-mobile-dark-polish-r0981.css';
import '../current-admin-dark-summary-r0982.css';
import '../current-sealed-component-economics-r0985.css';
import '../current-sealed-component-table-r0991.css';
import '../current-sealed-component-best-r0992.css';
import '../current-sealed-detail-zoom-r0993.css';
import '../current-sealed-detail-source-anchors-r0995.css';
import '../current-sealed-summary-actions-r1000.css';
import '../current-sealed-summary-tcg-r1001.css';
import '../current-sealed-detail-freshness-r1002.css';
import '../current-sealed-language-confidence-r1003.css';
import '../current-sealed-language-filter-r1004.css';
import '../current-scout-detail-tile-links-r0986.css';
import '../current-build-badge-r1012.css';

import './runtime/config.js';
import './lazy-pages.js';
import { installRestBridge } from './runtime/rest.js';
import { runClassicSequence } from './run-classic.js';

import buildRefresh from '../current-build-refresh-safe-r1011.js?raw';
import theme from '../current-theme.js?raw';
import core from '../modern-core.js?raw';
import buildBadge from '../current-build-badge-r1012.js?raw';
import cacheRead from '../current-scout-v5-cache-read.js?raw';
import runtimeHealth from '../current-runtime-health.js?raw';
import readonlyAgent from '../current-readonly-agent.js?raw';
import scoutBootstrap from '../current-scout-bootstrap-safe.js?raw';
import scoutHealth from '../current-scout-health-monitor-r1009.js?raw';
import volatility from '../current-scout-volatility-overlay-r0983.js?raw';
import scoutLinks from '../current-scout-detail-tile-links-r0986.js?raw';
import sealedBest from '../current-sealed-component-best-r0992.js?raw';
import sealedAnchors from '../current-sealed-detail-source-anchors-r0997.js?raw';
import sealedActions from '../current-sealed-summary-actions-r1000.js?raw';
import sealedTcg from '../current-sealed-summary-tcg-r1001.js?raw';
import sealedFreshness from '../current-sealed-detail-freshness-r1002.js?raw';
import sealedLanguage from '../current-sealed-language-confidence-r1003.js?raw';
import sealedGuardian from '../current-sealed-ui-guardian-r1008.js?raw';
import scoutImages from '../current-scout-list-images.js?raw';
import scoutNoise from '../current-scout-noise-filter.js?raw';
import scoutSearch from '../current-scout-global-search.js?raw';
import scoutVendor from '../current-scout-global-vendor.js?raw';
import scoutSemantics from '../current-scout-tcg-price-semantics.js?raw';
import detailSwipe from '../current-mobile-detail-swipe.js?raw';
import inventory from '../current-inventory-v2.js?raw';
import adminScans from '../current-admin-scans.js?raw';
import adminNav from '../current-admin-fixed-nav.js?raw';
import adminHealth from '../current-admin-marketplace-health.js?raw';
import adminConsole from '../current-admin-console.js?raw';
import adminSealedCatalog from '../current-admin-sealed-catalog-r0973.js?raw';
import adminSealedHealth from '../current-admin-sealed-health.js?raw';
import adminTop from '../current-admin-top.js?raw';
import ask from '../current-ask-collectish.js?raw';
import askMarkdown from '../current-ask-markdown-safe.js?raw';
import askInvestigate from '../current-ask-investigate-presentation.js?raw';
import askConcise from '../current-ask-concise-view.js?raw';
import askV3Investigate from '../current-ask-collectish-v3-investigate-safe.js?raw';
import askV3Actions from '../current-ask-collectish-v3-actions-safe.js?raw';
import askV3Admin from '../current-ask-collectish-v3-admin-safe.js?raw';

// Shell/auth still run with classic semantics for compatibility. Immediately after the
// shell boots, replace its private REST function with the native ESM runtime.
runClassicSequence([
  ['current-build-refresh-safe-r1011.js', buildRefresh],
  ['current-theme.js', theme],
  ['modern-core.js', core],
  ['current-build-badge-r1012.js', buildBadge]
]);
installRestBridge();

runClassicSequence([
  ['current-scout-v5-cache-read.js', cacheRead],
  ['current-runtime-health.js', runtimeHealth],
  ['current-readonly-agent.js', readonlyAgent],
  ['current-scout-bootstrap-safe.js', scoutBootstrap],
  ['current-scout-health-monitor-r1009.js', scoutHealth],
  ['current-scout-volatility-overlay-r0983.js', volatility],
  ['current-scout-detail-tile-links-r0986.js', scoutLinks],
  ['current-sealed-component-best-r0992.js', sealedBest],
  ['current-sealed-detail-source-anchors-r0997.js', sealedAnchors],
  ['current-sealed-summary-actions-r1000.js', sealedActions],
  ['current-sealed-summary-tcg-r1001.js', sealedTcg],
  ['current-sealed-detail-freshness-r1002.js', sealedFreshness],
  ['current-sealed-language-confidence-r1003.js', sealedLanguage],
  ['current-sealed-ui-guardian-r1008.js', sealedGuardian],
  ['current-scout-list-images.js', scoutImages],
  ['current-scout-noise-filter.js', scoutNoise],
  ['current-scout-global-search.js', scoutSearch],
  ['current-scout-global-vendor.js', scoutVendor],
  ['current-scout-tcg-price-semantics.js', scoutSemantics],
  ['current-mobile-detail-swipe.js', detailSwipe],
  ['current-inventory-v2.js', inventory],
  ['current-admin-scans.js', adminScans],
  ['current-admin-fixed-nav.js', adminNav],
  ['current-admin-marketplace-health.js', adminHealth],
  ['current-admin-console.js', adminConsole],
  ['current-admin-sealed-catalog-r0973.js', adminSealedCatalog],
  ['current-admin-sealed-health.js', adminSealedHealth],
  ['current-admin-top.js', adminTop],
  ['current-ask-collectish.js', ask],
  ['current-ask-markdown-safe.js', askMarkdown],
  ['current-ask-investigate-presentation.js', askInvestigate],
  ['current-ask-concise-view.js', askConcise],
  ['current-ask-collectish-v3-investigate-safe.js', askV3Investigate],
  ['current-ask-collectish-v3-actions-safe.js', askV3Actions],
  ['current-ask-collectish-v3-admin-safe.js', askV3Admin]
]);
