import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('canonical mobile navigation layers agree on five product destinations',async()=>{
  const product=await read('src/styles/product-navigation.css');
  const mobile=await read('src/styles/mobile-quality.css');
  const index=await read('src/styles/index.css');
  expect(product).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
  expect(mobile).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
  expect(mobile).not.toContain('repeat(7,minmax(0,1fr))');
  expect(index.indexOf("@import './product-navigation.css'"))
    .toBeLessThan(index.indexOf("@import './mobile-quality.css'"));
});

test('mobile bottom navigation resolves to five equal touch-safe targets',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile layout contract');
  await page.goto('/');
  const metrics=await page.evaluate(()=>{
    const nav=document.createElement('nav');
    nav.className='cx-mobile-nav';
    nav.innerHTML='<button>Scout</button><button>Signals</button><button>Selling</button><button>Ask</button><button>More</button>';
    document.body.appendChild(nav);
    const style=getComputedStyle(nav),buttons=[...nav.querySelectorAll('button')];
    const result={
      columns:style.gridTemplateColumns.trim().split(/\s+/).length,
      display:style.display,
      heights:buttons.map(button=>button.getBoundingClientRect().height),
      overflow:nav.scrollWidth-document.documentElement.clientWidth
    };
    nav.remove();
    return result;
  });
  expect(metrics.display).toBe('grid');
  expect(metrics.columns).toBe(5);
  expect(Math.min(...metrics.heights)).toBeGreaterThanOrEqual(48);
  expect(metrics.overflow).toBeLessThanOrEqual(1);
});

test('navigation and Scout controls expose keyboard focus and touch-safe sizing',async()=>{
  const product=await read('src/styles/product-navigation.css');
  const mobile=await read('src/styles/mobile-quality.css');
  expect(product).toContain(':focus-visible');
  expect(product).toContain('min-height:44px');
  expect(product).toContain('min-height:48px');
  expect(mobile).toContain(':where(button,a,input,select,textarea,summary):focus-visible');
  expect(mobile).toContain('#cxScout .cx-scout-saved-views button');
  expect(mobile).toContain('min-height:44px');
  expect(mobile).toContain('env(safe-area-inset-bottom)');
});

test('Scout mobile rows keep five decision metrics directly comparable',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile decision-density contract');
  await page.goto('/');
  const result=await page.evaluate(()=>{
    const host=document.createElement('div');
    host.id='cxParityCards';
    host.innerHTML='<button class="cx-scout-card cx-scout-dense-row"><span class="cx-scout-dense-card"><span></span><span class="cx-scout-dense-name"><span class="cx-scout-mobile-metrics"><span><small>Score</small><b>88</b></span><span><small>Market</small><b>$10</b></span><span><small>Direct</small><b>$12</b></span><span><small>Premium</small><b>+20%</b></span><span><small>Velocity</small><b>1.4/d</b></span><span><small>CK BL</small><b>$8</b></span></span></span></span></button>';
    document.body.appendChild(host);
    const box=host.querySelector('.cx-scout-mobile-metrics');
    const visible=[...box.children].filter(el=>getComputedStyle(el).display!=='none');
    const rects=visible.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,width:r.width}});
    const measured={
      visible:visible.map(el=>el.querySelector('small')?.textContent),
      columns:getComputedStyle(box).gridTemplateColumns.trim().split(/\s+/).length,
      rects
    };
    host.remove();
    return measured;
  });
  expect(result.visible).toEqual(['Market','Direct','Premium','Velocity','CK BL']);
  expect(result.columns).toBe(5);
  expect(Math.max(...result.rects.map(r=>r.top))-Math.min(...result.rects.map(r=>r.top))).toBeLessThan(1);
  expect(Math.max(...result.rects.map(r=>r.width))-Math.min(...result.rects.map(r=>r.width))).toBeLessThan(1);
});

test('Scout mobile detail resolves as a full-screen child surface above persistent navigation',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile inspector contract');
  await page.goto('/');
  const metrics=await page.evaluate(()=>{
    const scout=document.createElement('section');
    scout.id='cxScout';
    scout.innerHTML='<div class="cx-scout-layout"><section></section><aside class="cx-scout-detail cx-mobile-detail-open"><button class="cx-mobile-detail-close">×</button><div class="cx-v5-compact-head"><img class="cx-scout-hero"><div class="cx-v5-compact-info"><div class="cx-v5-compact-title">Card</div></div></div><div class="cx-v5-score-strip"><span class="cx-v5-score-chip"><b>Thesis</b><strong>10</strong></span><span class="cx-v5-score-chip"><b>Exec</b><strong>8</strong></span><span class="cx-v5-score-chip"><b>Floor</b><strong>5</strong></span><span class="cx-v5-score-chip"><b>Conf</b><strong>4</strong></span></div><section class="cx-v5-tier-best"><h3 class="cx-section-title">Best trade</h3></section><section class="cx-v5-tier-cash"><h3 class="cx-section-title">Cash floor</h3></section></aside></div>';
    document.body.appendChild(scout);
    const aside=scout.querySelector('aside'),art=scout.querySelector('.cx-scout-hero'),scores=scout.querySelector('.cx-v5-score-strip'),best=scout.querySelector('.cx-v5-tier-best'),cash=scout.querySelector('.cx-v5-tier-cash'),close=scout.querySelector('.cx-mobile-detail-close');
    const result={
      position:getComputedStyle(aside).position,
      top:getComputedStyle(aside).top,
      bottom:getComputedStyle(aside).bottom,
      maxHeight:getComputedStyle(aside).maxHeight,
      artWidth:art.getBoundingClientRect().width,
      scoreDisplay:getComputedStyle(scores).display,
      scoreColumns:getComputedStyle(scores).gridTemplateColumns.trim().split(/\s+/).length,
      bestRadius:getComputedStyle(best).borderRadius,
      cashRadius:getComputedStyle(cash).borderRadius,
      closeWidth:close.getBoundingClientRect().width
    };
    scout.remove();
    return result;
  });
  expect(metrics.position).toBe('fixed');
  expect(parseFloat(metrics.top)).toBe(0);
  expect(parseFloat(metrics.bottom)).toBeGreaterThanOrEqual(56);
  expect(metrics.maxHeight).toBe('none');
  expect(metrics.artWidth).toBeLessThanOrEqual(124);
  expect(metrics.scoreDisplay).toBe('none');
  expect(metrics.bestRadius).toBe('0px');
  expect(metrics.cashRadius).toBe('0px');
  expect(metrics.closeWidth).toBeLessThanOrEqual(38);
});

test('reduced-motion preference disables decorative motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  const duration=await page.evaluate(()=>{
    const probe=document.createElement('button');
    probe.style.transition='transform 5s linear';
    document.body.appendChild(probe);
    return getComputedStyle(probe).transitionDuration;
  });
  expect(parseFloat(duration)).toBeLessThanOrEqual(.001);
});
