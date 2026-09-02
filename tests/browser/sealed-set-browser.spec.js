import {test,expect} from '@playwright/test';

const token=()=>`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.sig`;
async function seed(page){
  await page.addInitScript(session=>localStorage.setItem('collectishSession',JSON.stringify(session)),{token:token(),refresh:'test',exp:Date.now()+3600_000,user:{id:'sealed-user',email:'sealed@example.com'}});
  await page.route('**/rest/v1/**',route=>{
    const u=route.request().url();let body=[];
    if(u.includes('sealed_ev_current'))body=[{sealed_uuid:'p1',product_name:'Secrets of Strixhaven Commander Deck',set_code:'STC',category:'deck',subtype:'commander',release_date:'2026-08-21',scout_sealed_score:81,scout_sealed_grade:'A',sealed_acquisition_price:40,tcg_market_ev:62,market_coverage_pct:98,lifecycle_status:'scout_sealed'}];
    else if(u.includes('mtgjson_sealed_products'))body=[{uuid:'p1',name:'Secrets of Strixhaven Commander Deck',set_code:'STC',category:'deck',subtype:'commander',release_date:'2026-08-21',tcgplayer_product_id:'123'},{uuid:'p2',name:'Secrets of Strixhaven Collector Booster Box',set_code:'STS',category:'booster_box',subtype:'collector',release_date:'2026-08-21',tcgplayer_product_id:'124'}];
    else if(u.includes('magic_set_catalog'))body=[{code:'STC',name:'Secrets of Strixhaven Commander',set_type:'commander',released_at:'2026-08-21'},{code:'STS',name:'Secrets of Strixhaven',set_type:'expansion',released_at:'2026-08-21'}];
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('**/functions/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
}

test('mobile Sealed drills from grouped sets into products and restores via browser Back',async({page})=>{
  await seed(page);await page.setViewportSize({width:412,height:915});await page.goto('/');
  await page.getByRole('button',{name:'Sealed',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Scout Sealed'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Commander Decks'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Expansions'})).toBeVisible();
  await page.getByRole('button',{name:/Secrets of Strixhaven Commander STC/}).click();
  await expect(page.getByRole('heading',{name:'Secrets of Strixhaven Commander'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Secrets of Strixhaven Commander Deck/})).toBeVisible();
  await expect(page).toHaveURL(/sealedView=set/);await expect(page).toHaveURL(/set=stc/);
  await page.goBack();
  await expect(page.getByRole('heading',{name:'Commander Decks'})).toBeVisible();
});
