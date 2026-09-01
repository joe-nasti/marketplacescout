import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function injectSignalStory(page){
  let source=await readFile('src/modules/signals/competitive-evidence.js','utf8');
  source=source
    .replace("import store from '../../state/store.js';","const store=window.__storyStore;")
    .replace("import { rest } from '../../core/rest.js';","const rest=window.__storyRest;");
  await page.addScriptTag({type:'module',content:source});
}

test('Signal Story replaces the clinical evidence label throughout Scout and Signals',async()=>{
  const source=await readFile('src/modules/signals/competitive-evidence.js','utf8');
  expect(source).toContain('<div class="cx-evidence-kicker">Signal Story</div>');
  expect(source).toContain('<div class="cx-section-title">Signal Story');
  expect(source).toContain('Open Signal Story →');
  expect(source).not.toContain('Evidence trail');
});

test('Signal Story, deck and Raw Source screens share browser and Android history',async()=>{
  const source=await readFile('src/modules/signals/competitive-evidence.js','utf8');
  expect(source).toContain("u.searchParams.set('story',card)");
  expect(source).toContain("u.searchParams.set('storyItem',item)");
  expect(source).toContain("item:`deck:${deckId}`");
  expect(source).toContain('<div class="cx-evidence-kicker">Raw Source</div>');
  expect(source).toContain("addEventListener('popstate',()=>void syncStoryRoute())");
});

test('mobile Signal Story is a full screen above persistent bottom navigation',async()=>{
  const css=await readFile('src/styles/signals-story.css','utf8');
  expect(css).toContain('.cx-evidence-shell{bottom:calc(56px + env(safe-area-inset-bottom));z-index:9000}');
  expect(css).toContain('.cx-evidence-drawer{inset:0;width:100%;height:auto;border:0;border-radius:0');
});

test('Signal Story and Raw Source restore their parent screens through browser Back',async({page})=>{
  await page.route('**/__signal-story-harness__',route=>route.fulfill({
    status:200,
    contentType:'text/html',
    body:'<!doctype html><html><body><main id="cxScout"><aside id="cxParityDetail"><div class="cx-v5-components"></div></aside></main></body></html>'
  }));
  await page.goto('/__signal-story-harness__?tab=scout&q=solphim&grade=A');
  await page.exposeFunction('__storyRest',async(path)=>{
    if(path.startsWith('competitive_deck_cards?select=deck_id'))return [];
    if(path.startsWith('market_intel_entities?'))return [{intel_id:'intel-1',entity_name:'Solphim, Mayhem Dominus',entity_type:'card'}];
    if(path.startsWith('market_intel_card_mentions?'))return [];
    if(path.startsWith('market_intel_items?'))return [{intel_id:'intel-1',source_type:'video',source_name:'Test Channel',source_url:'https://example.com/source',title:'Solphim market signal',author:'Collector One',summary:'A stored summary of the observed signal.',published_at:'2026-08-20T12:00:00Z',observed_at:'2026-08-21T12:00:00Z'}];
    if(path.startsWith('market_intel_video_events?'))return [{video_event_id:'moment-1',intel_id:'intel-1',video_id:'video-1',event_type:'mention',start_ms:83000,evidence:'Direct discussion of demand.',speaker_name:'Host'}];
    if(path==='rpc/commander_edh_opportunities'||path==='rpc/cedh_card_opportunities')return [];
    return [];
  });
  await page.evaluate(()=>{
    window.__storyStore={get:()=>({scout:{rows:[{sku_id:'sku-1',product_name:'Solphim, Mayhem Dominus'}]}})};
  });
  await injectSignalStory(page);

  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('collectish:open-card-evidence',{detail:{card_name:'Solphim, Mayhem Dominus'}})));
  await expect(page.getByRole('heading',{name:'Solphim, Mayhem Dominus'})).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('story')).toBe('Solphim, Mayhem Dominus');
  expect(new URL(page.url()).searchParams.get('q')).toBe('solphim');
  expect(new URL(page.url()).searchParams.get('grade')).toBe('A');

  await page.getByRole('button',{name:/Sources/}).click();
  await expect.poll(()=>new URL(page.url()).searchParams.get('storyView')).toBe('sources');
  await page.getByRole('button',{name:'View source ›'}).click();
  await expect(page.getByText('Raw Source',{exact:true})).toBeVisible();
  await expect(page.getByText('A stored summary of the observed signal.')).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('storyItem')).toBe('intel:intel-1');

  await page.goBack();
  await expect(page.getByRole('button',{name:/Sources/})).toHaveClass(/active/);
  await expect(page.getByRole('button',{name:'View source ›'})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('storyItem')).toBeNull();

  await page.goBack();
  await expect(page.locator('#cxCompetitiveEvidence')).not.toHaveClass(/open/);
  const restored=new URL(page.url());
  expect(restored.searchParams.get('story')).toBeNull();
  expect(restored.searchParams.get('q')).toBe('solphim');
  expect(restored.searchParams.get('grade')).toBe('A');
});
