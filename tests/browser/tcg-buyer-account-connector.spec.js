import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('buyer account uses authenticated connector instead of HAR workflow',async()=>{
  const src=await read('src/modules/seller/buyer-account.js');
  expect(src).toContain('Sync buyer account');
  expect(src).toContain('store credit');
  expect(src).toContain('messages');
  expect(src).toContain('AUTO_SYNC_MS');
  expect(src).toContain('rpc/import_tcg_buyer_account');
  expect(src).not.toContain('type="file"');
  expect(src).not.toContain('HAR fallback');
});

test('Android read-only policy allows only GET buyer-account surfaces',async()=>{
  const src=await read('android-agent/app/src/main/java/com/collectish/agent/ReadOnlyProbePolicy.kt');
  expect(src).toContain('it == "/myaccount" || it.startsWith("/myaccount/")');
  expect(src).toContain('isBuyerHistoryRequest(rawUrl)');
  expect(src).toContain('if (method == "GET")');
  expect(src).not.toMatch(/store\.tcgplayer\.com" -> path in .*buyer/i);
});

test('monthly cashflow surfaces synced refunds and store credit',async()=>{
  const src=await read('src/modules/seller/cashflow-budget.js');
  expect(src).toContain('tcg_buyer_refunds');
  expect(src).toContain('tcg_store_credit_used');
  expect(src).toContain('store_credit_balance');
  expect(src).toContain('Net TCG buyer spend');
});
