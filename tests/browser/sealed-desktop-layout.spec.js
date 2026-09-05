import { test, expect } from '@playwright/test';

const token=()=>`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.sig`;

async function seed(page){
  await page.addInitScript(session=>localStorage.setItem('collectishSession',JSON.stringify(session)),{token:token(),refresh:'test',exp:Date.now()+3600_000,user:{id:'sealed-user',email:'sealed@example.com'}});
  const products=[
    ['gift','The Hobbit Gift Bundle','bundle','gift_bundle',175],
    ['gift-case','The Hobbit Gift Bundle Case','bundle','gift_bundle_case',1050],
    ['play-box','The Hobbit Play Booster Box','booster_box','play',140],
    ['collector-box','The Hobbit Collector Booster Box','booster_box','collector',280],
    ['play','The Hobbit Play Booster Pack','booster_pack','play',5],
    ['collector','The Hobbit Collector Booster Pack','booster_pack','collector',25],
  ];
  await page.route('**/rest/v1/**',route=>{
    const u=route.request().url();let body=[];
    if(u.includes('sealed_ev_current'))body=products.map(([sealed_uuid,product_name,category,subtype,price],i)=>({sealed_uuid,product_name,set_code:'HOB',category,subtype,release_date:'2026-08-21',scout_sealed_score:85-i,scout_sealed_grade:'B',sealed_acquisition_price:price,tcg_market_ev:price*.8,market_coverage_pct:98,lifecycle_status:'scout_sealed'}));
    else if(u.includes('sealed_product_executable_ev_cache'))body=products.map(([sealed_uuid,,, ,price],i)=>({sealed_uuid,tcg_low_ev:price*.65,direct_first_net_ev:price*.61,collectish_live_out_ev:price*.7,practical_liquidation_ev:price*.58,practical_median_estimate:price*.5,practical_p10_estimate:price*.3,top10_practical_ev_share_pct:42,practical_scout_score:70-i,practical_scout_grade:'C',practical_action:'KEEP SEALED',price_coverage_pct:97,valuation_basis:'current_only'}));
    else if(u.includes('sealed_product_model_coverage'))body=products.map(([sealed_uuid,product_name,category,subtype])=>({sealed_uuid,set_code:'HOB',product_name,category,subtype,release_date:'2026-08-21',adapter_key:'hob-v1',adapter_name:'Hobbit',profile_status:'full',coverage_state:'FULL MODEL',recommendation_eligible:true,coverage_reason:'Modeled card value is complete',sealed_market_price:100,sealed_low_price:95,crack_value_basis:'direct_backtest',crack_value_complete:true,model_status:'modeled',modeled_child_components:0,unmodeled_child_components:0,unresolved_deck_components:0,unresolved_pack_components:0,unresolved_other_components:0,noncard_extras_excluded:false}));
    else if(u.includes('magic_set_catalog'))body=[{code:'HOB',name:'The Hobbit',set_type:'expansion',released_at:'2026-08-21'}];
    else if(u.includes('mtgjson_sealed_products')&&u.includes('source_updated_at'))body=[{source_updated_at:'2026-09-02T00:00:00Z'}];
    else if(u.includes('mtgjson_sealed_products'))body=products.map(([uuid,name,category,subtype])=>({uuid,name,set_code:'HOB',category,subtype,release_date:'2026-08-21'}));
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('**/functions/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
}

test('1440px Scout Sealed product rows stay contained beside detail pane',async({page})=>{
  await seed(page);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');
  await page.getByRole('button',{name:'Sealed',exact:true}).click();
  await page.getByRole('button',{name:/The Hobbit HOB/}).click();
  await expect(page.getByRole('button',{name:/The Hobbit Gift Bundle/}).first()).toBeVisible();

  const geometry=await page.evaluate(()=>{
    const detail=document.querySelector('#cxSealedDetail')?.getBoundingClientRect();
    const group=document.querySelector('.cx-sealed-product-groups');
    const rows=[...document.querySelectorAll('#cxSealedRows button[data-deck]')].filter(node=>node.getBoundingClientRect().width>0);
    return {
      groupClient:group?.clientWidth||0,
      groupScroll:group?.scrollWidth||0,
      rows:rows.map(node=>{
        const box=node.getBoundingClientRect();
        return {
          clientWidth:node.clientWidth,
          scrollWidth:node.scrollWidth,
          contentRight:box.left+node.scrollWidth,
          detailLeft:detail?.left??Infinity,
        };
      }),
    };
  });

  expect(geometry.groupScroll).toBeLessThanOrEqual(geometry.groupClient+2);
  expect(geometry.rows.length).toBeGreaterThanOrEqual(6);
  for(const row of geometry.rows){
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth+2);
    expect(row.contentRight).toBeLessThanOrEqual(row.detailLeft+2);
  }
});
