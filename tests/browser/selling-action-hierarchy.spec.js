import {test,expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const sourcePath=path.join(process.cwd(),'src/modules/seller/dashboard-view.js');
const loadView=async()=>import(`${pathToFileURL(sourcePath).href}?test=${Date.now()}-${Math.random()}`);

test('Selling Overview puts real exceptions before history metrics and activity',async()=>{
  const {sellerDashboardView}=await loadView();
  const html=sellerDashboardView({summary:{order_count:24,gross_sales:1200,total_fees:240,net_after_refunds:910,order_refund_total:50,refund_record_count:2,review_count:10,average_rating:4.8,missing_detail_count:3,low_review_count:1,pending_payment_count:2,ri_discrepancy_count:0},recentOrders:[]});
  const attention=html.indexOf('cx-sellv-attention-panel'),metrics=html.indexOf('cx-sellv-metrics'),orders=html.indexOf('cx-sellv-orders-panel');
  expect(attention).toBeGreaterThan(-1);
  expect(metrics).toBeGreaterThan(attention);
  expect(orders).toBeGreaterThan(metrics);
  expect(html).toContain('<strong>Needs attention</strong>');
  expect(html).toContain('<strong>Missing order details</strong>');
  expect(html).toContain('<strong>Low reviews</strong>');
  expect(html).toContain('<strong>Pending payments</strong>');
  expect(html).toContain('<strong>Recent orders</strong>');
});

test('healthy Selling Overview avoids a prominent empty alert panel',async()=>{
  const {sellerDashboardView}=await loadView();
  const html=sellerDashboardView({summary:{order_count:24,gross_sales:1200,total_fees:240,net_after_refunds:960,review_count:10,average_rating:4.9}});
  expect(html).not.toContain('cx-sellv-attention-panel');
  expect(html).toContain('cx-sellv-clear');
  expect(html).toContain('<strong>All clear</strong>');
  expect(html.indexOf('cx-sellv-metrics')).toBeLessThan(html.indexOf('cx-sellv-clear'));
});

test('Selling action targets remain touch-safe on mobile',async()=>{
  const source=await readFile(sourcePath,'utf8');
  expect(source).toContain('#cxSellerRoute .cx-sellv-attention{grid-template-columns:1fr}');
  expect(source).toContain('#cxSellerRoute .cx-sellv-attention button{min-height:48px');
  expect(source).toContain('#cxSellerRoute .cx-sellv-row{grid-template-columns:minmax(0,1fr) auto auto;padding:9px 10px;min-height:48px}');
  expect(source).toContain('#cxSellerRoute .cx-sellv-product{grid-template-columns:minmax(0,1fr) auto auto;min-height:48px}');
});
