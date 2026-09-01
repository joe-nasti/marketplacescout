import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals mobile polish belongs to the canonical route owner',async()=>{
  const css=await read('src/styles/signals-mobile-polish.css');
  expect(css).toContain('#cxSignals .cx-sv-row');
  expect(css).not.toContain('#cxSignalsVnext');
  expect(css).toContain("'art stage stage chevron'");
  expect(css).toContain("'art card card chevron'");
  expect(css).toContain("'art source confidence scout'");
  expect(css).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
  expect(css).toContain('.cx-sv-sheet');
});

test('Signals mobile rows prioritize lifecycle, thesis, source, and decision rails',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile hierarchy contract');
  await page.goto('/');
  await page.addStyleTag({path:path.join(process.cwd(),'src/styles/signals-mobile-polish.css')});
  const result=await page.evaluate(()=>{
    const host=document.createElement('section');
    host.id='cxSignals';
    host.innerHTML=`<div class="cx-sv-list"><button class="cx-sv-row"><span class="cx-sv-art cx-sv-art-fallback">C</span><span class="cx-sv-stage-line"><span class="cx-sv-chip cx-sv-confirming">Confirming</span><small>2h</small></span><span class="cx-sv-card"><strong>Example Card</strong><small>Supply is falling while marketplace sales confirm demand.</small></span><span class="cx-sv-source"><span>MTGO + creators</span><small>3 sources · $10 buy</small></span><span class="cx-sv-score cx-sv-confidence"><small>Confidence</small><strong>82%</strong></span><span class="cx-sv-score cx-sv-scout"><small>Scout</small><strong>88</strong></span><span class="cx-sv-score cx-sv-market"><small>Market</small><strong>+24%</strong><em>24% edge</em></span><span class="cx-sv-chevron">›</span></button></div>`;
    document.body.appendChild(host);
    const q=s=>host.querySelector(s)?.getBoundingClientRect();
    const stage=q('.cx-sv-stage-line'),card=q('.cx-sv-card'),source=q('.cx-sv-source'),confidence=q('.cx-sv-confidence'),scout=q('.cx-sv-scout'),market=q('.cx-sv-market'),row=q('.cx-sv-row');
    const reason=host.querySelector('.cx-sv-card small'),rowEl=host.querySelector('.cx-sv-row'),cardName=host.querySelector('.cx-sv-card strong');
    const style=getComputedStyle(rowEl),reasonStyle=getComputedStyle(reason),cardStyle=getComputedStyle(cardName);
    const out={
      stageTop:stage?.top,
      cardTop:card?.top,
      sourceTop:source?.top,
      confidenceTop:confidence?.top,
      scoutTop:scout?.top,
      marketTop:market?.top,
      rowHeight:row?.height,
      reasonWhiteSpace:reasonStyle.whiteSpace,
      cardOverflow:cardStyle.overflow,
      confidenceColor:getComputedStyle(host.querySelector('.cx-sv-confidence strong')).color,
      scoutColor:getComputedStyle(host.querySelector('.cx-sv-scout strong')).color,
      radius:Number.parseFloat(style.borderRadius)
    };
    host.remove();return out;
  });
  expect(result.stageTop).toBeLessThan(result.cardTop);
  expect(result.cardTop).toBeLessThan(result.sourceTop);
  expect(Math.abs(result.confidenceTop-result.scoutTop)).toBeLessThanOrEqual(3);
  expect(result.sourceTop).toBeLessThanOrEqual(result.marketTop);
  expect(result.reasonWhiteSpace).toBe('normal');
  expect(result.cardOverflow).toBe('hidden');
  expect(result.confidenceColor).not.toBe(result.scoutColor);
  expect(result.rowHeight).toBeGreaterThanOrEqual(136);
  expect(result.radius).toBe(0);
});

test('Signals mobile controls are touch-sized and lifecycle metrics stay in one rail',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile controls contract');
  await page.goto('/');
  await page.addStyleTag({path:path.join(process.cwd(),'src/styles/signals-mobile-polish.css')});
  const result=await page.evaluate(()=>{
    const host=document.createElement('section');
    host.id='cxSignals';
    host.innerHTML=`<div class="cx-sv-nav"><button>For you</button><button>Sources</button></div><div class="cx-sv-metrics"><div class="cx-sv-metric"><span>Actionable</span><strong>12</strong><small>now</small></div><div class="cx-sv-metric"><span>Emerging</span><strong>8</strong><small>early</small></div><div class="cx-sv-metric"><span>Confirming</span><strong>5</strong><small>sales</small></div><div class="cx-sv-metric"><span>Watch</span><strong>7</strong><small>later</small></div></div><div class="cx-sv-toolbar"><input><button>Filters</button><button>Priority</button></div>`;
    document.body.appendChild(host);
    const metricGrid=getComputedStyle(host.querySelector('.cx-sv-metrics')).gridTemplateColumns;
    const navHeight=host.querySelector('.cx-sv-nav button').getBoundingClientRect().height;
    const filterHeight=host.querySelector('.cx-sv-toolbar button').getBoundingClientRect().height;
    const inputHeight=host.querySelector('.cx-sv-toolbar input').getBoundingClientRect().height;
    host.remove();
    return {metricGrid,navHeight,filterHeight,inputHeight};
  });
  expect(result.metricGrid.trim().split(/\s+/)).toHaveLength(4);
  expect(result.navHeight).toBeGreaterThanOrEqual(38);
  expect(result.filterHeight).toBeGreaterThanOrEqual(42);
  expect(result.inputHeight).toBeGreaterThanOrEqual(42);
});
