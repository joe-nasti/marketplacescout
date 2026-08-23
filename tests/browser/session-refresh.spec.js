import { test, expect } from '@playwright/test';

const SESSION_KEY='collectishSession';
const expiredSession={
  token:'expired-access-token',
  refresh:'saved-refresh-token',
  exp:Date.now()-60_000,
  user:{id:'test-user',email:'test@example.com'}
};

async function seedExpiredSession(page){
  await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:SESSION_KEY,session:expiredSession});
}

test('transient refresh failure preserves saved session for retry',async({page})=>{
  await seedExpiredSession(page);
  await page.route('**/auth/v1/token?grant_type=refresh_token',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'temporary outage'})}));
  await page.goto('/');
  await expect(page.locator('#modernSignIn')).toBeVisible();
  const saved=await page.evaluate(key=>localStorage.getItem(key),SESSION_KEY);
  expect(saved).not.toBeNull();
  expect(JSON.parse(saved).refresh).toBe('saved-refresh-token');
});

test('rejected refresh token clears unusable session',async({page})=>{
  await seedExpiredSession(page);
  await page.route('**/auth/v1/token?grant_type=refresh_token',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Invalid Refresh Token'})}));
  await page.goto('/');
  await expect(page.locator('#modernSignIn')).toBeVisible();
  const saved=await page.evaluate(key=>localStorage.getItem(key),SESSION_KEY);
  expect(saved).toBeNull();
});

test('successful refresh resumes authenticated shell',async({page})=>{
  await seedExpiredSession(page);
  const futureExp=Math.floor(Date.now()/1000)+3600;
  const payload=Buffer.from(JSON.stringify({exp:futureExp})).toString('base64url');
  const refreshedToken=`header.${payload}.sig`;
  await page.route('**/auth/v1/token?grant_type=refresh_token',route=>route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({access_token:refreshedToken,refresh_token:'rotated-refresh-token',expires_in:3600,user:expiredSession.user})
  }));
  await page.goto('/');
  await expect(page.locator('.collectish-product-shell')).toBeVisible();
  await expect(page.locator('[data-collectish-startup-error]')).toHaveCount(0);
  const saved=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),SESSION_KEY));
  expect(saved.refresh).toBe('rotated-refresh-token');
});
