import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('Signals exposes the approved five mobile intelligence views',async()=>{
  const source=await readFile('src/modules/signals/index.js','utf8');
  for(const label of ['For you','Discovery','Competitive','Commander','Secret Lair'])expect(source).toContain(`>${label}</button>`);
  expect(source).toContain("const SIGNAL_VIEWS=['scan','discovery','competitive','commander','secret-lair']");
  expect(source).not.toContain('>Signal story</button>');
});

test('Signals subviews participate in browser history and restore their own scroll',async()=>{
  const source=await readFile('src/modules/signals/index.js','utf8');
  expect(source).toContain("scrollByView.set(mode,scrollY)");
  expect(source).toContain("history.pushState({...history.state,collectishSignalsView:mode}");
  expect(source).toContain("window.addEventListener('popstate'");
  expect(source).toContain("scrollByView.get(view)||0");
  expect(source).toContain("url.searchParams.set('signalsView',mode)");
});

test('Signals subview panels are mutually exclusive full-width mobile surfaces',async()=>{
  const css=await readFile('src/styles/signals-mobile-polish.css','utf8');
  expect(css).toContain('#cxSignals[data-signals-view="competitive"] #cxCompetitiveIntel');
  expect(css).toContain('#cxSignals[data-signals-view="commander"] #cxCommanderIntel');
  expect(css).toContain('#cxSignals[data-signals-view="secret-lair"] #cxSecretLairSignals');
  expect(css).toContain('#cxSignals[data-signals-view="discovery"] #cxSignalsDiscovery');
});
