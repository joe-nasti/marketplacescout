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

test('composite sealed detail rolls child products through economics and optimization',async({page})=>{
  await page.addInitScript(session=>localStorage.setItem('collectishSession',JSON.stringify(session)),{token:token(),refresh:'test',exp:Date.now()+3600_000,user:{id:'sealed-user',email:'sealed@example.com'}});
  await page.route('**/rest/v1/**',route=>{
    const u=route.request().url();let body=[];
    if(u.includes('sealed_ev_current'))body=[{sealed_uuid:'gift',product_name:'The Hobbit Gift Bundle',set_code:'HOB',category:'bundle',subtype:'gift_bundle',release_date:'2026-08-21',sealed_acquisition_price:175,tcg_market_ev:9.09,optimized_live_out_ev:20.65,optimized_with_syp_potential_ev:20.65,tcg_regular_net_ev:0,manapool_net_est_ev:12.87,cash_floor_ev:14.45}];
    else if(u.includes('sealed_product_child_components'))body=[{child_sealed_uuid:'play',child_product_name:'The Hobbit Play Booster Pack',quantity:9,component_type:'sealed'},{child_sealed_uuid:'collector',child_product_name:'The Hobbit Collector Booster Pack',quantity:1,component_type:'sealed'}];
    else if(u.includes('rpc/get_sealed_family_economics_fast'))body=[{sealed_uuid:'gift',crack_gross_mean_ev:136.24,crack_net_mean_ev:102.1975,fixed_tcg_market_ev:9.09,modeled_child_units:10,crack_value_complete:true},{sealed_uuid:'play',crack_gross_mean_ev:6.81,crack_net_mean_ev:5.11},{sealed_uuid:'collector',crack_gross_mean_ev:65.86,crack_net_mean_ev:49.39}];
    else if(u.includes('sealed_product_executable_ev_cache'))body=[{sealed_uuid:'gift',tcg_low_ev:87.14,direct_first_net_ev:83.2,collectish_live_out_ev:116.77,fixed_tcg_low_ev:6,fixed_collectish_live_out_ev:20.65,modeled_child_units:10,valuation_basis:'children_plus_fixed_current_only'},{sealed_uuid:'play',tcg_low_ev:3.46,direct_first_net_ev:3.33,collectish_live_out_ev:5.68,valuation_basis:'randomized_current_only'},{sealed_uuid:'collector',tcg_low_ev:50,direct_first_net_ev:47,collectish_live_out_ev:45,valuation_basis:'randomized_current_only'}];
    else if(u.includes('sealed_out_optimization_current'))body=[{card_name:'Bilbo, Birthday Celebrant',sku_id:'sku-1',finish:'foil',quantity:1,live_best_channel:'Card Kingdom',live_best_unit_net:20.65,live_best_component_ev:20.65,potential_best_channel:'Card Kingdom',potential_best_component_ev:20.65,ck_cash:20.65}];
    else if(u.includes('rpc/get_sealed_component_economics'))body=[{card_name:'Bilbo, Birthday Celebrant',set_code:'HOB',collector_number:'1',finish:'foil',quantity:1,sku_id:'sku-1',tcg_market:9.09}];
    else if(u.includes('magic_set_catalog'))body=[{code:'HOB',name:'The Hobbit',set_type:'expansion',released_at:'2026-08-21'}];
    else if(u.includes('mtgjson_sealed_products')&&u.includes('source_updated_at'))body=[{source_updated_at:'2026-09-02T00:00:00Z'}];
    else if(u.includes('mtgjson_sealed_products'))body=[{uuid:'gift',name:'The Hobbit Gift Bundle',set_code:'HOB',category:'bundle',subtype:'gift_bundle',release_date:'2026-08-21'}];
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('**/functions/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await page.setViewportSize({width:412,height:915});await page.goto('/');
  await page.getByRole('button',{name:'Sealed',exact:true}).click();
  await page.getByRole('button',{name:/The Hobbit HOB/}).click();
  const giftRow=page.getByRole('button',{name:/The Hobbit Gift Bundle/});
  await expect(giftRow).toContainText('Collectish EV');
  await expect(giftRow).toContainText('$116.77');
  await expect(giftRow).toContainText('Collectish spread');
  await expect(giftRow).toContainText('-$58.23');
  await giftRow.click();
  await expect(page.getByText('Total Collectish EV',{exact:true}).first()).toBeVisible();
  await expect(page.locator('.cx-sealed-component-summary')).toContainText('9');
  await expect(page.locator('.cx-sealed-component-summary')).toContainText('The Hobbit Play Booster Pack');
  await expect(page.locator('.cx-sealed-component-summary')).toContainText('The Hobbit Collector Booster Pack');
  await expect(page.locator('.cx-sealed-component-summary')).toContainText('$116.77');
  await expect(page.locator('.cx-out-opt')).toContainText('Included Products Net');
  await expect(page.locator('.cx-out-opt')).toContainText('$96.12');
  await expect(page.locator('.cx-out-opt')).toContainText('$116.77');
});
