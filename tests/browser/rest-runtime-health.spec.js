import { test, expect } from '@playwright/test';

const SESSION_KEY='collectishSession';
function token(){const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `h.${payload}.s`}

async function seed(page){
  const session={token:token(),refresh:'runtime-refresh',exp:Date.now()+3600_000,user:{id:'runtime-user',email:'runtime@example.com'}};
  await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:SESSION_KEY,value:session});
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url();
    if(url.includes('/test_endpoint?')&&url.includes('fail=eq.true'))return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'synthetic failure'})});
    if(url.includes('/test_endpoint?'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{ok:true}])});
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.route('**/functions/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
}

test('Runtime Health attributes REST cost without retaining query identifiers',async({page})=>{
  await seed(page);
  await page.goto('/');
  await page.waitForFunction(()=>window.CollectishApi?.rest);

  await page.evaluate(()=>window.CollectishApi.rest('test_endpoint?select=id,name&id=eq.private-card-id'));
  await page.evaluate(async()=>{try{await window.CollectishApi.rest('test_endpoint?select=id&fail=eq.true')}catch{}});

  const metrics=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('collectishRuntimeHealth')||'{}'));
  const stats=metrics.rest_endpoint_stats||{};
  expect(stats.test_endpoint).toBeTruthy();
  expect(stats.test_endpoint.count).toBe(2);
  expect(stats.test_endpoint.errors).toBe(1);
  expect(stats.test_endpoint.bytes).toBeGreaterThan(0);
  expect(stats.test_endpoint.maxMs).toBeGreaterThanOrEqual(0);
  expect(Object.keys(stats).some(k=>k.includes('?')||k.includes('private-card-id')||k.includes('eq.'))).toBe(false);
  expect(JSON.stringify(stats)).not.toContain('private-card-id');
});
