import { runClassicSequence } from '../../run-classic.js';
import promotedRenderer from '../../../current-scout-v5-promoted.js?raw';

let installed=false;

export function installScoutRenderer(){
  if(installed)return;
  installed=true;
  runClassicSequence([
    ['current-scout-v5-promoted.js',promotedRenderer]
  ]);
}

export default installScoutRenderer;
