import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const rendererSource=await readFile(new URL('../../src/modules/ask/market-investigation-surface.js',import.meta.url),'utf8');

test('Ask aligns internal and external market events and renders useful source titles',async({page})=>{
  await page.setContent('<main id="askFixture"><div class="cx-ask-msg cx-ask-assistant"><div class="cx-ask-msg-body">Grounded answer.</div></div></main>');
  await page.addScriptTag({content:rendererSource});
  await page.evaluate(()=>{
    const body=document.querySelector('.cx-ask-msg-body');
    window.__CollectishAskSurfaceQueue=[{schema:'collectish.ask.surface.v8',surfaces:[
      {type:'market_timeline',title:'Market timeline',days:120,events:[
        {event_at:'2026-06-19T00:00:00Z',kind:'sales',title:'Sales volume spike',detail:'30 units / 28 transactions',significance:22},
        {event_at:'2026-08-10T12:00:00Z',kind:'external',title:'What is the best Descent into Avernus deck?',detail:'Community · medium confidence',significance:20,data:{url:'https://reddit.com/r/EDH/example'}},
        {event_at:'2026-08-20T00:00:00Z',kind:'price',title:'Market repriced',detail:'Market $12.17 → $13.06 (+7.3%)',significance:7.3}
      ]},
      {type:'external_research',title:'External evidence',source_count:2,sources:[
        {url:'https://edhrec.com/cards/descent-into-avernus',title:'Descent into Avernus — EDHREC',kind:'Commander'},
        {url:'https://www.reddit.com/r/EDH/comments/test/pros_and_cons_of_descent_into_avernus/',title:'Pros and Cons of Descent into Avernus in Smaug',kind:'Community'}
      ]}
    ]}];
    document.dispatchEvent(new CustomEvent('collectish:ask-message-rendered',{detail:{role:'assistant',element:body}}));
  });
  const timeline=page.locator('.cx-ask-market-timeline');
  await expect(timeline).toContainText('Market timeline');
  await expect(timeline).toContainText('Sales volume spike');
  await expect(timeline).toContainText('What is the best Descent into Avernus deck?');
  await expect(timeline).toContainText('Market repriced');
  const evidence=page.locator('.cx-ask-external-research');
  await expect(evidence).toContainText('Descent into Avernus — EDHREC');
  await expect(evidence).toContainText('Pros and Cons of Descent into Avernus in Smaug');
});
