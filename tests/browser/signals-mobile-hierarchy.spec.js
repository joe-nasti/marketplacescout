import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals mobile polish belongs to the canonical route owner',async()=>{
  const css=await read('src/styles/signals-mobile-polish.css');
  expect(css).toContain('#cxSignals .cx-sv-row');
  expect(css).not.toContain('#cxSignalsVnext');
  expect(css).toContain("'card move move'");
  expect(css).toContain("'signal signal signal'");
  expect(css).toContain("'price conf scout'");
});

test('Signals mobile rows prioritize stage reason and buy edge over modeled metadata',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile hierarchy contract');
  await page.goto('/');
  const result=await page.evaluate(()=>{
    const host=document.createElement('section');
    host.id='cxSignals';
    host.innerHTML=`<div class="cx-sv-list"><button class="cx-sv-row"><span class="cx-sv-card"><strong>Example Card</strong><small>SET · NM</small></span><span class="cx-sv-signal"><span class="cx-sv-chip cx-sv-confirming">Confirming</span><span class="cx-sv-sales-confirm"><b>4tx</b></span><small>Supply is falling while marketplace sales confirm demand.</small></span><span class="cx-sv-num"><strong>3</strong><small>Evidence</small></span><span class="cx-sv-num"><strong>82</strong><small>Confidence</small></span><span class="cx-sv-num"><strong>88</strong><small>Scout</small></span><span class="cx-sv-price"><strong>$10.00</strong><small>24.0% edge</small></span><span class="cx-sv-move bullish"><strong>↑</strong><small>2h</small></span></button></div>`;
    document.body.appendChild(host);
    const q=s=>host.querySelector(s)?.getBoundingClientRect();
    const evidence=host.querySelector('.cx-sv-num:nth-of-type(3)');
    const signal=q('.cx-sv-signal'),price=q('.cx-sv-price'),confidence=q('.cx-sv-num:nth-of-type(4)'),scout=q('.cx-sv-num:nth-of-type(5)');
    const reason=host.querySelector('.cx-sv-signal>small'),row=host.querySelector('.cx-sv-row'),priceSmall=host.querySelector('.cx-sv-price small');
    const out={evidenceDisplay:getComputedStyle(evidence).display,signalTop:signal?.top,priceTop:price?.top,confidenceTop:confidence?.top,scoutTop:scout?.top,reasonColor:getComputedStyle(reason).color,rowColor:getComputedStyle(row).color,priceWeight:getComputedStyle(priceSmall).fontWeight,confidenceOpacity:Number(getComputedStyle(host.querySelector('.cx-sv-num:nth-of-type(4)')).opacity),scoutOpacity:Number(getComputedStyle(host.querySelector('.cx-sv-num:nth-of-type(5)')).opacity)};
    host.remove();return out;
  });
  expect(result.evidenceDisplay).toBe('none');
  expect(result.signalTop).toBeLessThan(result.priceTop);
  expect(Math.abs(result.priceTop-result.confidenceTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(result.priceTop-result.scoutTop)).toBeLessThanOrEqual(2);
  expect(result.reasonColor).toBe(result.rowColor);
  expect(Number(result.priceWeight)).toBeGreaterThanOrEqual(700);
  expect(result.confidenceOpacity).toBeLessThan(1);
  expect(result.scoutOpacity).toBeLessThan(1);
});
