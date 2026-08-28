import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals to Scout bridge preserves the originating catalyst',async()=>{
  const source=await read('src/modules/signals/scout-intelligence-bridge.js');
  expect(source).toContain('originIntelId');
  expect(source).toContain('origin_intel_id');
  expect(source).toContain('Why this is showing up');
  expect(source).toContain('Opened from Signals');
  expect(source).toContain('signalCatalysts(row)');
  expect(source).toContain('market_intel_card_mentions');
});

test('Scout intelligence badges acknowledge linked Signals',async()=>{
  const source=await read('src/modules/signals/scout-intelligence-bridge.js');
  expect(source).toContain("out.push(`SIG ${ctx.signals.length}`)");
  expect(source).toContain('Signals and corroborating evidence explain why this card deserves attention.');
  expect(source).toContain('They do not change the Scout grade yet.');
});

test('Scout catalyst UI has a distinct originating-signal state and mobile readability',async()=>{
  const css=await read('src/styles/scout-signal-catalysts.css');
  const index=await read('src/styles/index.css');
  expect(index).toContain("@import './scout-signal-catalysts.css';");
  expect(css).toContain('.cx-scout-catalyst.is-origin');
  expect(css).toContain('@media(max-width:600px)');
  expect(css).toContain('font-size:13px');
  expect(css).toContain('min-height:36px');
});
