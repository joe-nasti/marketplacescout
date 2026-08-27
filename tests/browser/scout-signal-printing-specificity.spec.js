import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Scout uses exact-SKU Signal confidence and attenuates related-printing Interests',async()=>{
  const [ui,skuSql,scopeSql,collector]=await Promise.all([
    read('src/modules/signals/scout-badges.js'),
    read('cloud-worker/scout-signal-sku-confidence.sql'),
    read('cloud-worker/mtgstocks-interest-printing-scope.sql'),
    read('cloud-worker/mtgstocks-interests.mjs')
  ]);
  expect(ui).toContain('market_intel_scout_confidence_sku');
  expect(ui).toContain("confidence.get(String(row?.sku_id||''))");
  expect(ui).toContain('Interests related-printing only');
  expect(skuSql).toContain("specificity_weight");
  expect(skuSql).toContain("isolated to another printing or finish");
  expect(scopeSql).toContain("resolve_mtgstocks_interest_links");
  expect(scopeSql).toContain("cross_print_corroborated");
  expect(collector).toContain("rpc/resolve_mtgstocks_interest_links");
  expect(collector.indexOf('rpc/resolve_mtgstocks_interest_links')).toBeLessThan(collector.indexOf('rpc/enqueue_market_intel_scout_wakes'));
});
