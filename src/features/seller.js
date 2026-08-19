import { runClassicSequence } from '../run-classic.js';
import parity from '../../current-seller-parity.js?raw';
import orderMeta from '../../current-seller-overview-order-meta.js?raw';
import filters from '../../current-seller-order-filters.js?raw';
import drilldowns from '../../current-seller-drilldowns.js?raw';
import polish from '../../current-seller-detail-polish.js?raw';

export function install(){
  runClassicSequence([
    ['current-seller-parity.js', parity],
    ['current-seller-overview-order-meta.js', orderMeta],
    ['current-seller-order-filters.js', filters],
    ['current-seller-drilldowns.js', drilldowns],
    ['current-seller-detail-polish.js', polish]
  ]);
}
