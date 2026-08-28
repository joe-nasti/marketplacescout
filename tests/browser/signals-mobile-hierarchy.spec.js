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
  expect(css).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');
  expect(css).toContain('background:var(--cx-card)');
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
    const signal=q('.cx-sv-signal'),price=q('.cx-sv-price'),confidence=q('.cx-sv-num:nth-of-type(4)'),scout=q('.cx-sv-num:nth-of-type(5)'),row=q('.cx-sv-row');
    const reason=host.querySelector('.cx-sv-signal>small'),rowEl=host.querySelector('.cx-sv-row'),priceSmall=host.querySelector('.cx-sv-price small'),cardName=host.querySelector('.cx-sv-card strong');
    const style=getComputedStyle(rowEl),reasonStyle=getComputedStyle(reason),cardStyle=getComputedStyle(cardName);
    const out={
      evidenceDisplay:getComputedStyle(evidence).display,
      signalTop:signal?.top,
      priceTop:price?.top,
      confidenceTop:confidence?.top,
      scoutTop:scout?.top,
      rowHeight:row?.height,
      reasonColor:reasonStyle.color,
      rowColor:style.color,
      reasonWhiteSpace:reasonStyle.whiteSpace,
      cardWhiteSpace:cardStyle.whiteSpace,
      priceWeight:getComputedStyle(priceSmall).fontWeight,
      confidenceOpacity:Number(getComputedStyle(host.querySelector('.cx-sv-num:nth-of-type(4)')).opacity),
      scoutOpacity:Number(getComputedStyle(host.querySelector('.cx-sv-num:nth-of-type(5)')).opacity),
      radius:Number.parseFloat(style.borderRadius)
    };
    host.remove();return out;
  });
  expect(result.evidenceDisplay).toBe('none');
  expect(result.signalTop).toBeLessThan(result.priceTop);
  expect(Math.abs(result.priceTop-result.confidenceTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(result.priceTop-result.scoutTop)).toBeLessThanOrEqual(2);
  expect(result.reasonColor).toBe(result.rowColor);
  expect(result.reasonWhiteSpace).toBe('normal');
  expect(result.cardWhiteSpace).toBe('normal');
  expect(Number(result.priceWeight)).toBeGreaterThanOrEqual(700);
  expect(result.confidenceOpacity).toBeLessThan(1);
  expect(result.scoutOpacity).toBeLessThan(1);
  expect(result.rowHeight).toBeGreaterThanOrEqual(96);
  expect(result.radius).toBeGreaterThanOrEqual(12);
});

test('Signals mobile controls are touch-sized and metrics become a 2x2 summary',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile controls contract');
  await page.goto('/');
  const result=await page.evaluate(()=>{
    const host=document.createElement('section');
    host.id='cxSignals';
    host.innerHTML=`<div class="cx-sv-nav"><button>Scan</button><button>Sources</button></div><div class="cx-sv-metrics"><div class="cx-sv-metric"><span>Actionable</span><strong>12</strong><small>now</small></div><div class="cx-sv-metric"><span>Emerging</span><strong>8</strong><small>early</small></div><div class="cx-sv-metric"><span>Confirming</span><strong>5</strong><small>sales</small></div><div class="cx-sv-metric"><span>Watch</span><strong>7</strong><small>later</small></div></div><div class="cx-sv-toolbar"><div class="cx-sv-filters"><button>All</button><button>Actionable</button></div><input><button>Refresh</button></div>`;
    document.body.appendChild(host);
    const metricGrid=getComputedStyle(host.querySelector('.cx-sv-metrics')).gridTemplateColumns;
    const navHeight=host.querySelector('.cx-sv-nav button').getBoundingClientRect().height;
    const filterHeight=host.querySelector('.cx-sv-filters button').getBoundingClientRect().height;
    const inputHeight=host.querySelector('.cx-sv-toolbar input').getBoundingClientRect().height;
    host.remove();
    return {metricGrid,navHeight,filterHeight,inputHeight};
  });
  expect(result.metricGrid.trim().split(/\s+/)).toHaveLength(2);
  expect(result.navHeight).toBeGreaterThanOrEqual(40);
  expect(result.filterHeight).toBeGreaterThanOrEqual(38);
  expect(result.inputHeight).toBeGreaterThanOrEqual(42);
});
