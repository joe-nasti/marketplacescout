import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const rendererSource=await readFile(new URL('../../src/modules/ask/market-investigation-surface.js',import.meta.url),'utf8');

test('Ask renders date-bucket-safe timeline with separate evidence and causal confidence',async({page})=>{
  await page.setViewportSize({width:412,height:915});
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="askFixture"><div class="cx-ask-msg cx-ask-assistant"><div class="cx-ask-msg-body"><h3>Quick read</h3><p>No hard catalyst found. The best lead precedes measured acceleration.</p><h3>External findings</h3><p>Long supporting analysis.</p><h3>Timing / causation details</h3><p>More long analysis.</p></div></div></main></body></html>');
  await page.addScriptTag({content:rendererSource});
  await page.evaluate(()=>{
    const body=document.querySelector('.cx-ask-msg-body');
    window.__CollectishAskSurfaceQueue=[{schema:'collectish.ask.surface.v9',surfaces:[
      {type:'market_timeline',title:'Market timeline',days:120,acceleration_at:'2026-08-18T00:00:00Z',events:[
        {event_at:'2026-06-19T00:00:00Z',kind:'sales',title:'Sales volume spike',detail:'30 units / 28 transactions',significance:22},
        {event_at:'2026-08-13T12:00:00Z',kind:'external',title:'Pros and Cons of Descent into Avernus in Smaug',significance:40,data:{url:'https://reddit.com/r/EDH/example',evidence_confidence:'high',causal_relevance:'plausible',days_from_acceleration:-5}},
        {event_at:'2026-08-19T12:00:00Z',kind:'external',title:'Late corroborating discussion',significance:10,data:{url:'https://reddit.com/r/EDH/later',evidence_confidence:'high',causal_relevance:'followed acceleration',days_from_acceleration:1}},
        {event_at:'2026-08-20T00:00:00Z',kind:'price',title:'Market repriced',detail:'Market $12.17 → $13.06 (+7.3%)',significance:7.3}
      ]},
      {type:'market_investigation',title:'Market investigation',data:{card:{product_name:'Descent into Avernus'},scout:{grade:'A',score:89,market:13.95},sales:{units_90d:381},supply:{direct_available:190},edhrec:{rank:889},intel:{claim_count:0,source_count:0}}},
      {type:'external_research',title:'External evidence',card:{product_name:'Descent into Avernus'},sources:[
        {url:'https://www.reddit.com/r/EDH/comments/test/pros_and_cons_of_descent_into_avernus/',title:'Pros and Cons of Descent into Avernus in Smaug',kind:'Community',evidence_role:'event_evidence'},
        {url:'https://edhrec.com/cards/descent-into-avernus',title:'Descent into Avernus — EDHREC',kind:'Commander',evidence_role:'background'}
      ]}
    ]}];
    document.dispatchEvent(new CustomEvent('collectish:ask-message-rendered',{detail:{role:'assistant',element:body}}));
  });
  const timeline=page.locator('.cx-ask-market-timeline');
  await expect(timeline.locator('time')).toContainText(['Jun 19','Aug 13','Aug 19','Aug 20']);
  await expect(timeline).toContainText('verified: high');
  await expect(timeline).toContainText('causal link: plausible');
  await expect(timeline).toContainText('Measured acceleration anchor: Aug 18');
  await expect(timeline.locator('.is-causal-plausible')).toHaveCount(1);
  await expect(timeline.locator('.is-causal-followed-acceleration')).toHaveCount(1);
  const body=page.locator('.cx-ask-msg-body');
  await expect(body).toContainText('No hard catalyst found');
  await expect(body.locator('.cx-ask-full-analysis')).toBeHidden();
  await expect(body.locator('.cx-ask-analysis-toggle')).toHaveText('Show full analysis');
  await expect(page.locator('.cx-ask-pass34-surfaces.is-lead')).toContainText('Market timeline');
  const investigation=page.locator('.cx-ask-investigation-surface');
  await expect(investigation).toContainText('Linked Signals');
  const evidence=page.locator('.cx-ask-external-research');
  await expect(evidence).toContainText('1 evidence · 1 background');
  await expect(evidence).toContainText('Pros and Cons of Descent into Avernus in Smaug');
  await expect(evidence.locator('summary')).toContainText('Background/reference (1)');
});
