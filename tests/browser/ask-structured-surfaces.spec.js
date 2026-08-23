import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const rendererSource=await readFile(new URL('../../src/modules/ask/structured-surfaces.js',import.meta.url),'utf8');

test('Ask renders typed market-intelligence surfaces without model-formatted UI',async({page})=>{
  await page.goto('/');
  await page.addScriptTag({content:rendererSource});
  await page.evaluate(()=>{
    const msg=document.createElement('div');msg.className='cx-ask-msg cx-ask-assistant';
    const body=document.createElement('div');body.className='cx-ask-msg-body';body.textContent='Grounded answer.';msg.append(body);document.body.append(msg);
    window.__CollectishAskSurfaceQueue=[{schema:'collectish.ask.surface.v3',surfaces:[
      {type:'market_intelligence',title:'Market intelligence',data:{rollup:{entity_name:'Test Card',claim_count:4,independent_source_count:3,intel_direction_score:2},claims:[{title:'Demand is accelerating',source_name:'Test Source',direction:'bullish',signal_stage:'leading',confidence:.91}]}},
      {type:'cross_source_watch',title:'Cross-source watch',items:[{card_name:'Test Card',product_id:'123',corroboration_score:88,evidence_sources:4,watch_reason:'competitive · EDHREC · articles/social'}]}
    ]}];
    document.dispatchEvent(new CustomEvent('collectish:ask-message-rendered',{detail:{role:'assistant',element:body}}));
  });
  const surfaces=page.locator('.cx-ask-rich-surfaces');
  await expect(surfaces).toContainText('Market intelligence');
  await expect(surfaces).toContainText('Demand is accelerating');
  await expect(surfaces).toContainText('Cross-source watch');
  await expect(surfaces).toContainText('88 corroboration');
});
