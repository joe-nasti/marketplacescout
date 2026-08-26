import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('canonical mobile navigation layers agree on four product destinations',async()=>{
  const product=await read('src/styles/product-navigation.css');
  const mobile=await read('src/styles/mobile-quality.css');
  const index=await read('src/styles/index.css');
  expect(product).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
  expect(mobile).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
  expect(mobile).not.toContain('repeat(7,minmax(0,1fr))');
  expect(index.indexOf("@import './product-navigation.css'"))
    .toBeLessThan(index.indexOf("@import './mobile-quality.css'"));
});

test('mobile bottom navigation resolves to four equal touch-safe targets',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile layout contract');
  await page.goto('/');
  const metrics=await page.evaluate(()=>{
    const nav=document.createElement('nav');
    nav.className='cx-mobile-nav';
    nav.innerHTML='<button>Scout</button><button>Signals</button><button>Selling</button><button>More</button>';
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
  expect(metrics.columns).toBe(4);
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

test('Scout mobile rows prioritize decision metrics instead of repeating score',async({page},testInfo)=>{
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
  expect(result.columns).toBe(6);
  expect(Math.max(...result.rects.slice(0,3).map(r=>r.top))-Math.min(...result.rects.slice(0,3).map(r=>r.top))).toBeLessThan(1);
  expect(Math.abs(result.rects[3].top-result.rects[4].top)).toBeLessThan(1);
  expect(result.rects[3].top).toBeGreaterThan(result.rects[0].top);
  expect(result.rects[3].width).toBeGreaterThan(result.rects[0].width*1.35);
  expect(result.rects[4].width).toBeGreaterThan(result.rects[1].width*1.35);
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
