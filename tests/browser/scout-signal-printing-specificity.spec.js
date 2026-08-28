import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Scout keeps exact-SKU Signal specificity inside unified opportunity context',async()=>{
  const [ui,skuSql,scopeSql,contextSql,collector]=await Promise.all([
    read('src/modules/signals/scout-badges.js'),
    read('cloud-worker/scout-signal-sku-confidence.sql'),
    read('cloud-worker/mtgstocks-interest-printing-scope.sql'),
    read('cloud-worker/scout-opportunity-context.sql'),
    read('cloud-worker/mtgstocks-interests.mjs')
  ]);
  expect(ui).toContain('scout_opportunity_context');
  expect(ui).toContain("context.get(String(row?.sku_id||''))");
  expect(ui).toContain("return'MTGStocks · exact SKU moving'");
  expect(ui).toContain("return'MTGStocks · related printing moved; this SKU did not'");
  expect(ui).toContain("badge.dataset.signalScope='related-printing-only'");
  expect(ui).toContain('<b>MTGStocks scope:</b>');
  expect(ui).toContain('related-printing context does not mean this SKU spiked');
  expect(ui).toContain('related printing/context, not proof this SKU moved');
  expect(skuSql).toContain('specificity_weight');
  expect(skuSql).toContain('isolated to another printing or finish');
  expect(contextSql).toContain('interest_exact_signal_count');
  expect(contextSql).toContain("'thin_print_anomaly'");
  expect(contextSql).toContain("'reprint_migration'");
  expect(contextSql).toContain("'prestige_printing'");
  expect(contextSql).not.toContain("'related_printing_only'=any(risk_flags)");
  expect(scopeSql).toContain('resolve_mtgstocks_interest_links');
  expect(scopeSql).toContain('cross_print_corroborated');
  expect(collector).toContain('rpc/resolve_mtgstocks_interest_links');
  expect(collector.indexOf('rpc/resolve_mtgstocks_interest_links')).toBeLessThan(collector.indexOf('rpc/enqueue_market_intel_scout_wakes'));
});
