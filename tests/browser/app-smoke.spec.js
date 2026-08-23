import { test, expect } from '@playwright/test';

test('unauthenticated shell renders without startup failure',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#modernSignIn')).toBeVisible();
  await expect(page.locator('#modernEmail')).toBeVisible();
  await expect(page.locator('#modernPassword')).toBeVisible();
  await expect(page.locator('[data-collectish-startup-error]')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Sign in'})).toBeVisible();
});

test('current viewport has no horizontal page overflow',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#modernSignIn')).toBeVisible();
  const layout=await page.evaluate(()=>({
    innerWidth:window.innerWidth,
    scrollWidth:document.documentElement.scrollWidth,
    bodyWidth:document.body.scrollWidth
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth+1);
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.innerWidth+1);
});

test('auth controls remain usable on touch viewports',async({page,isMobile})=>{
  test.skip(!isMobile,'mobile-only control sizing check');
  await page.goto('/');
  await expect(page.locator('#modernSignIn')).toBeVisible();
  for(const selector of ['#modernEmail','#modernPassword','#modernSignIn']){
    const box=await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
