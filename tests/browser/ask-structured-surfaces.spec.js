import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const rendererSource=await readFile(new URL('../../src/modules/ask/structured-surfaces.js',import.meta.url),'utf8');

test('Ask renders typed market-intelligence surfaces without model-formatted UI',async({page})=>{
  // This is a renderer unit fixture. Keep it isolated from the real app boot
  // lifecycle so shell/auth startup cannot replace the synthetic message DOM.
  await page.setContent('<main id="askFixture"></main>');
  await page.addScriptTag({content:rendererSource});
  await page.evaluate(()=>{
    const msg=document.createElement('div');msg.className='cx-ask-msg cx-ask-assistant';
    const body=document.createElement('div');body.className='cx-ask-msg-body';body.textContent='Grounded answer.';msg.append(body);document.getElementById('askFixture').append(msg);
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

test('Ask renders a compact, scoped market radar and opens exact cards',async({page})=>{
  await page.setContent('<main id="askFixture"></main>');
  await page.addScriptTag({content:rendererSource});
  await page.evaluate(()=>{
    window.opened=[];
    window.AskCollectish={applyUiActions:actions=>window.opened.push(...actions)};
    const msg=document.createElement('div');msg.className='cx-ask-msg cx-ask-assistant';
    const body=document.createElement('div');body.className='cx-ask-msg-body';body.textContent='Market radar found 2 candidates.';msg.append(body);document.getElementById('askFixture').append(msg);
    window.__CollectishAskSurfaceQueue=[{schema:'collectish.ask.surface.v10',surfaces:[{
      type:'delvin_query',query_key:'market_radar',title:'What should I look at right now?',data:{payload:{stale:true,payload:{rows:[
        {card_name:'Test Leader',product_id:'321',set_code:'tst',printing:'Foil',source_count:3,sources:['sales_acceleration','mtgstocks','syp'],radar_score:94.5,bulk_spec_watch:true,bulk_spec_severity:'medium'},
        {card_name:'Second Card',source_count:1,sources:['direct_pressure'],radar_score:61}
      ]}}}
    }]}];
    document.dispatchEvent(new CustomEvent('collectish:ask-message-rendered',{detail:{role:'assistant',element:body}}));
  });
  const radar=page.locator('.cx-ask-market-radar');
  await expect(radar).toContainText('Market radar');
  await expect(radar).toContainText('TST · Foil · 3 signals · Radar 94.5');
  await expect(radar).toContainText('Sales Acceleration, MTGStocks, SYP · Bulk/spec watch (medium)');
  await expect(radar).toContainText('mixed source conditions');
  await expect(radar).toContainText('stale cache; refresh pending');
  await expect(radar.getByRole('button',{name:'Open Signals'})).toBeVisible();
  await radar.locator('.cx-ai-result-list button').first().click();
  await expect.poll(()=>page.evaluate(()=>window.opened)).toEqual([{type:'open_card',product_id:'321'}]);
});
