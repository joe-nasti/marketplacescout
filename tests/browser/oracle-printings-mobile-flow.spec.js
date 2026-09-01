import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const moduleSource=async(path,replacements=[])=>{
  let source=await readFile(path,'utf8');
  for(const [from,to] of replacements)source=source.replace(from,to);
  return source;
};

async function injectModule(page,path,replacements=[]){
  const source=await moduleSource(path,replacements);
  await page.addScriptTag({type:'module',content:source});
}

const ORACLE_ID='11111111-1111-1111-1111-111111111111';
const family=[
  {sku_id:'sku-1',product_id:'p1',scryfall_id:'sf1',card_name:'Solphim, Mayhem Dominus',set_code:'ONE',collector_number:'150',printing:'Normal',condition:'Near Mint',coverage_state:'baseline',last_evaluated_at:new Date().toISOString(),scout_score:82,scout_grade:'A',cheapest_buy:10,direct_net_profit:8,buylist_roi_pct:20,avg_daily_qty_sold:1.2},
  {sku_id:'sku-2',product_id:'p2',scryfall_id:'sf2',card_name:'Solphim, Mayhem Dominus',set_code:'ONE',collector_number:'400',printing:'Showcase',condition:'Near Mint',coverage_state:'baseline',last_evaluated_at:'2026-07-01T00:00:00Z',scout_score:78,scout_grade:'B',cheapest_buy:8,direct_net_profit:9,buylist_roi_pct:25,avg_daily_qty_sold:2.3},
  {sku_id:'sku-3',product_id:'p3',scryfall_id:'sf3',card_name:'Solphim, Mayhem Dominus',set_code:'ONE',collector_number:'401',printing:'Foil',condition:'Near Mint',coverage_state:'catalog',last_evaluated_at:null,scout_score:null,scout_grade:null,cheapest_buy:null,direct_net_profit:null,buylist_roi_pct:null,avg_daily_qty_sold:null}
];

test('mobile Oracle compare survives the full interaction lifecycle',async({page,isMobile})=>{
  test.skip(!isMobile,'mobile Oracle flow');
  const rpcCalls=[];
  await page.route('**/__oracle-harness__',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head></head><body></body></html>'}));
  await page.goto('/__oracle-harness__');
  await page.exposeFunction('__oracleTestRest',async(path,options={})=>{
    rpcCalls.push({path,body:options.body||null});
    if(path==='rpc/scout_catalog_by_oracle')return family.map(x=>({...x}));
    if(path==='rpc/request_scout_refresh')return [{already_open:false}];
    if(path==='rpc/scout_catalog_search')return [];
    return [];
  });
  await page.setContent(`
    <main id="cxScout">
      <div class="cx-scout-search-row"><input id="cxParitySearch"></div>
      <div class="cx-scout-toolbar"></div>
      <section id="cxParityDetail" class="cx-mobile-detail-open">
        <div class="cx-v5-title"><div><h2 class="cx-section-title">Solphim, Mayhem Dominus</h2></div></div>
      </section>
    </main>
  `);
  await page.evaluate(({oracleId})=>{
    document.body.classList.add('cx-scout-detail-lock');
    window.__oracleTestFetch=async()=>new Response(JSON.stringify({name:'Solphim, Mayhem Dominus',oracle_id:oracleId}),{status:200,headers:{'content-type':'application/json'}});
    window.__oracleTestState={scout:{selectedSku:'sku-1',rows:[{sku_id:'sku-1',product_id:'p1',scryfall_id:'sf1',set_code:'ONE',collector_number:'150',product_name:'Solphim, Mayhem Dominus'}]}};
    window.__oracleTestStore={get:()=>window.__oracleTestState};
    window.CollectishScoutRenderer={
      setSaved:()=>{},
      renderDetail:(row)=>{
        window.__oracleTestState.scout.selectedSku=String(row?.sku_id||'');
        const detail=document.getElementById('cxParityDetail');
        detail.dataset.restoredSku=String(row?.sku_id||'');
        detail.innerHTML=`<div class="cx-v5-title"><div><h2 class="cx-section-title">${row?.product_name||row?.card_name||'restored'}</h2></div></div>`;
        document.dispatchEvent(new CustomEvent('collectish:scout-detail-rendered',{detail:{sku:row?.sku_id}}));
      }
    };
  },{oracleId:ORACLE_ID});

  const restReplacement=[["import { rest } from '../../core/rest.js';","const rest=window.__oracleTestRest;"]];
  await injectModule(page,'src/modules/scout/universal-search.js',[
    ...restReplacement,
    ["import { readOracleFamily } from './oracle-family-data.js';","const readOracleFamily=(oracle,{limit=2000}={})=>window.__oracleTestRest('rpc/scout_catalog_by_oracle',{method:'POST',body:{p_oracle_id:oracle,p_limit:limit}});"]
  ]);
  await injectModule(page,'src/modules/scout/oracle-bulk-refresh.js',[
    ...restReplacement,
    ["import { readOracleFamily, seedOracleFamily } from './oracle-family-data.js';","const readOracleFamily=(oracle,{limit=2000}={})=>window.__oracleTestRest('rpc/scout_catalog_by_oracle',{method:'POST',body:{p_oracle_id:oracle,p_limit:limit}});const seedOracleFamily=(_oracle,rows)=>rows;"]
  ]);
  await injectModule(page,'src/modules/scout/oracle-detail-context.js');
  await injectModule(page,'src/modules/scout/oracle-family-confidence.js');
  await injectModule(page,'src/modules/scout/oracle-printings.js',[
    ["import store from '../../state/store.js';","const store=window.__oracleTestStore;"],
    ["import { readOracleFamily, seedOracleFamily } from './oracle-family-data.js';","const readOracleFamily=(oracle,{limit=2000}={})=>window.__oracleTestRest('rpc/scout_catalog_by_oracle',{method:'POST',body:{p_oracle_id:oracle,p_limit:limit}});const seedOracleFamily=(_oracle,rows)=>rows;"],
    ["fetch(`https://api.scryfall.com/","window.__oracleTestFetch(`https://api.scryfall.com/"]
  ]);

  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('collectish:scout-detail-rendered',{detail:{sku:'sku-1'}})));
  const compare=page.getByRole('button',{name:/Compare all printings/});
  await expect(compare).toBeVisible();
  await compare.click();

  await expect(page.locator('body')).not.toHaveClass(/cx-scout-detail-lock/);
  await expect(page.locator('#cxParityDetail')).not.toHaveClass(/cx-mobile-detail-open/);
  await expect.poll(()=>new URL(page.url()).searchParams.get('oracle')).toBe(ORACLE_ID);
  await expect(page.locator('.cx-oracle-result')).toHaveCount(3);
  await expect(page.locator('.cx-oracle-confidence')).toContainText('50% · Medium');

  await page.locator('[data-oracle-sort]').selectOption('direct');
  await expect.poll(()=>new URL(page.url()).searchParams.get('oracleSort')).toBe('direct');
  await expect(page.locator('.cx-oracle-result').first()).toHaveAttribute('data-universal-sku','sku-2');

  await page.locator('[data-oracle-filter]').selectOption('dormant');
  await expect(page.locator('.cx-oracle-result')).toHaveCount(1);
  await expect(page.locator('.cx-oracle-result')).toHaveAttribute('data-universal-sku','sku-2');
  await page.locator('[data-oracle-filter]').selectOption('all');
  await expect(page.locator('.cx-oracle-result')).toHaveCount(3);

  const bulk=page.locator('[data-oracle-bulk-refresh]');
  await expect(bulk).toContainText('Refresh 2 stale');
  await bulk.click();
  await expect.poll(()=>rpcCalls.filter(x=>x.path==='rpc/request_scout_refresh'&&x.body?.p_reason==='oracle_compare_bulk').length).toBe(2);

  await page.locator('.cx-oracle-result[data-universal-sku="sku-2"]').click();
  await expect(page.locator('#cxUniversalDetail .cx-universal-detail')).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('oracleOpenSku')).toBe('sku-2');
  const back=page.getByRole('button',{name:/Back to Solphim, Mayhem Dominus printings/});
  await expect(back).toBeVisible();
  await expect(page.locator('.cx-oracle-win-explain')).toContainText(/Why this printing (wins|currently leads)/);

  await back.click();
  await expect(page.locator('#cxUniversalResults')).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('oracleOpenSku')).toBe(null);

  const returnInline=page.locator('#cxUniversalResults [data-oracle-return]');
  await expect(returnInline).toBeVisible();
  await returnInline.click();
  await expect(page.locator('#cxParitySearch')).toHaveValue('');
  await expect(page.locator('#cxUniversalResults')).toBeHidden();
  await expect(page.locator('#cxUniversalDetail')).toBeEmpty();
  await expect(page.locator('#cxParityDetail')).toHaveAttribute('data-restored-sku','sku-1');
  await expect(page.locator('body')).not.toHaveClass(/cx-scout-detail-lock/);
  for(const key of ['oracle','fromSku','q','oracleSort','oracleFilter','oracleOpenSku']){
    expect(new URL(page.url()).searchParams.get(key)).toBeNull();
  }
});
