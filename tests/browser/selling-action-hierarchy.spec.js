import {test,expect} from '@playwright/test';

test('Selling Overview puts real exceptions before history metrics and activity',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {sellerDashboardView}=await import('/src/modules/seller/dashboard-view.js');
    const host=document.createElement('div');
    host.innerHTML=sellerDashboardView({summary:{order_count:24,gross_sales:1200,total_fees:240,net_after_refunds:910,order_refund_total:50,refund_record_count:2,review_count:10,average_rating:4.8,missing_detail_count:3,low_review_count:1,pending_payment_count:2,ri_discrepancy_count:0},recentOrders:[]});
    const dashboard=host.firstElementChild;
    return {
      children:[...dashboard.children].map(el=>el.className),
      title:dashboard.querySelector('.cx-sellv-attention-panel .cx-sellv-panel-head strong')?.textContent,
      flags:[...dashboard.querySelectorAll('.cx-sellv-attention button strong')].map(el=>el.textContent),
      recentTitle:dashboard.querySelector('.cx-sellv-orders-panel .cx-sellv-panel-head strong')?.textContent
    };
  });
  expect(result.children[0]).toContain('cx-sellv-attention-panel');
  expect(result.children[1]).toContain('cx-sellv-metrics');
  expect(result.title).toBe('Needs attention');
  expect(result.flags).toEqual(['Missing order details','Low reviews','Pending payments']);
  expect(result.recentTitle).toBe('Recent orders');
});

test('healthy Selling Overview avoids a prominent empty alert panel',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {sellerDashboardView}=await import('/src/modules/seller/dashboard-view.js');
    const host=document.createElement('div');
    host.innerHTML=sellerDashboardView({summary:{order_count:24,gross_sales:1200,total_fees:240,net_after_refunds:960,review_count:10,average_rating:4.9}});
    const dashboard=host.firstElementChild;
    return {
      hasAttention:!!dashboard.querySelector('.cx-sellv-attention-panel'),
      clear:dashboard.querySelector('.cx-sellv-clear')?.textContent,
      firstClass:dashboard.children[0]?.className
    };
  });
  expect(result.hasAttention).toBe(false);
  expect(result.clear).toContain('All clear');
  expect(result.firstClass).toContain('cx-sellv-metrics');
});

test('Selling action targets remain touch-safe on mobile',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop-chromium','mobile hierarchy contract');
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {sellerDashboardView,installSellerDashboardStyles}=await import('/src/modules/seller/dashboard-view.js');
    installSellerDashboardStyles();
    const host=document.createElement('div');
    host.id='cxSellerRoute';
    host.innerHTML=sellerDashboardView({summary:{missing_detail_count:2,low_review_count:1,pending_payment_count:1},recentOrders:[{order_number:'1',buyer_name:'Buyer',gross_amount:20,net_amount:15,has_details:false}]});
    document.body.appendChild(host);
    const attention=host.querySelector('.cx-sellv-attention-panel');
    const metrics=host.querySelector('.cx-sellv-metrics');
    const actionHeights=[...host.querySelectorAll('.cx-sellv-attention button')].map(el=>el.getBoundingClientRect().height);
    const orderHeight=host.querySelector('.cx-sellv-row')?.getBoundingClientRect().height||0;
    const measured={attentionTop:attention?.getBoundingClientRect().top,metricsTop:metrics?.getBoundingClientRect().top,actionHeights,orderHeight};
    host.remove();
    return measured;
  });
  expect(result.attentionTop).toBeLessThan(result.metricsTop);
  expect(Math.min(...result.actionHeights)).toBeGreaterThanOrEqual(48);
  expect(result.orderHeight).toBeGreaterThanOrEqual(48);
});
