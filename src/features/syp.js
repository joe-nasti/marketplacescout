import { runClassicSequence } from '../run-classic.js';
import parity from '../../current-syp-parity.js?raw';
import links from '../../current-syp-links.js?raw';

export function install(){
  runClassicSequence([
    ['current-syp-parity.js', parity],
    ['current-syp-links.js', links]
  ]);
}
