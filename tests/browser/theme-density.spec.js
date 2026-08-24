import { test, expect } from '@playwright/test';

const THEMES=['light','dark'];
const DENSE_SOURCES=[
  '/src/modules/signals/dense-vnext.js',
  '/src/modules/seller/inventory-dense-vnext.js',
  '/src/modules/seller/syp-dense-vnext.js',
  '/src/modules/scout/dense-list.js',
  '/src/modules/seller/dashboard-vnext.js',
  '/src/modules/sealed/dense-list.js',
  '/src/modules/admin/overview-vnext.js'
];

function channel(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)}
function luminance(rgb){
  const match=String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if(!match)throw new Error(`Unsupported color: ${rgb}`);
  const [r,g,b]=match.slice(1).map(Number).map(channel);
  return .2126*r+.7152*g+.0722*b;
}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}

for(const theme of THEMES){
  test(`${theme} theme keeps core dense-surface tokens readable and viewport-safe`,async({page})=>{
    await page.addInitScript(value=>localStorage.setItem('collectishTheme',value),theme);
    await page.goto('/');
    await expect(page.locator('#modernSignIn')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);

    const colors=await page.evaluate(()=>{
      const s=getComputedStyle(document.documentElement);
      const probe=document.createElement('div');
      probe.style.cssText='position:fixed;left:-9999px;top:-9999px;background:var(--color-bg-surface);color:var(--color-text-primary)';
      document.body.appendChild(probe);
      const p=getComputedStyle(probe);
      const value=name=>s.getPropertyValue(name).trim();
      const resolve=color=>{probe.style.color=color;return getComputedStyle(probe).color};
      const out={
        surface:p.backgroundColor,
        primary:p.color,
        secondary:resolve(value('--color-text-secondary')),
        accent:resolve(value('--color-accent')),
        success:resolve(value('--color-success')),
        danger:resolve(value('--color-danger')),
        warning:resolve(value('--color-warning'))
      };
      probe.remove();
      return out;
    });

    for(const key of ['primary','secondary','accent','success','danger','warning']){
      expect(contrast(colors[key],colors.surface),`${theme} ${key} contrast`).toBeGreaterThanOrEqual(4.5);
    }

    const layout=await page.evaluate(()=>({
      innerWidth:window.innerWidth,
      doc:document.documentElement.scrollWidth,
      body:document.body.scrollWidth,
      bg:getComputedStyle(document.body).backgroundColor,
      colorScheme:getComputedStyle(document.documentElement).colorScheme
    }));
    expect(layout.doc).toBeLessThanOrEqual(layout.innerWidth+1);
    expect(layout.body).toBeLessThanOrEqual(layout.innerWidth+1);
    expect(layout.colorScheme).toBe(theme);
  });
}

test('all vNext dense surfaces stay theme-token driven',async({page})=>{
  for(const path of DENSE_SOURCES){
    const response=await page.request.get(path);
    expect(response.ok(),`${path} should be served`).toBeTruthy();
    const source=await response.text();
    expect(source,`${path} must not hard-code CSS foreground/background colors`).not.toMatch(/(?:^|[;{])\s*(?:color|background(?:-color)?|border-color)\s*:\s*#[0-9a-f]{3,8}\b/i);
  }
});
