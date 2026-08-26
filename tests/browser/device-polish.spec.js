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
  await page.evaluate(()=>{
    const nav=document.createElement('nav');
    nav.className='cx-mobile-nav';
    nav.innerHTML='<button>Scout</button><button>Signals</button><button>Selling</button><button>More</button>';
    document.body.appendChild(nav);
  });
  const metrics=await page.locator('.cx-mobile-nav').evaluate(nav=>{
    const style=getComputedStyle(nav),buttons=[...nav.querySelectorAll('button')];
    return {
      columns:style.gridTemplateColumns.trim().split(/\s+/).length,
      display:style.display,
      heights:buttons.map(button=>button.getBoundingClientRect().height),
      overflow:nav.scrollWidth-document.documentElement.clientWidth
    };
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
