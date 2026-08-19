// Collectish Vite entrypoint.
// Vite owns hashing, CSS aggregation and chunking. Legacy feature code is isolated
// behind src/legacy-runtime.js and is being converted to native ESM incrementally.

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
import './runtime/build-info.js';
import './features/ask/markdown.js';
import './features/sealed/ui-guardian.js';
import './lazy-pages.js';
import { installRestBridge } from './runtime/rest.js';
import { installLegacyShell, installLegacyFeatures } from './legacy-runtime.js';

installLegacyShell();
installRestBridge();
installLegacyFeatures();
