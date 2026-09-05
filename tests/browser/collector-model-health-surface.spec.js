import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const scout='src/modules/sealed/collector-model-health.js';
const sealedIndex='src/modules/sealed/index.js';
const route='supabase/functions/ask-collectish-delvin-route-v2/index.ts';
const present='supabase/functions/ask-collectish-delvin-present-v2/index.ts';
const registry='supabase/migrations/20260905161500_register_collector_model_health_delvin.sql';

test('Scout model-health enrichment is Collector-only, fail-soft, and diagnostic',async()=>{
  const [ui,index]=await Promise.all([readFile(scout,'utf8'),readFile(sealedIndex,'utf8')]);
  expect(index).toContain("import('./collector-model-health.js')");
  expect(index).toContain('installCollectorModelHealth');
  expect(ui).toContain("subtype||'').toLowerCase()==='collector'");
  expect(ui).toContain('rpc/ask_collectish_collector_promotion_dashboard_v1');
  expect(ui).toContain('diagnostic only and does not change Scout grade, forecast authority, or executable economics');
  expect(ui).toContain('catch{/* diagnostic enrichment is fail-soft */}');
  expect(ui).not.toContain('practical_scout_grade=');
  expect(ui).not.toContain('promotion_status=');
});

test('Delvin owns Collector model health in the shared v2 registry route',async()=>{
  const [r,p,m]=await Promise.all([readFile(route,'utf8'),readFile(present,'utf8'),readFile(registry,'utf8')]);
  for(const s of [r,p,m])expect(s).toContain('collector_model_health');
  expect(r).toContain("rpc('ask_collectish_collector_promotion_dashboard_v1')");
  expect(r).toContain("Array.isArray(p.horizons)?p.horizons:[]");
  expect(p).toContain('Collector Box model health');
  expect(p).toContain('Pooled forecasts remain primary until every promotion gate is cleared');
  expect(p).toContain('Which lifecycle stages does the Collector model beat pooled on?');
  expect(m).toContain("'dynamic','collector_model_health'");
  expect(m).toContain('matcher_priority');
  expect(m).toContain('ready|eligible');
});

test('Collector model-health presentation preserves web/Discord parity fingerprinting',async()=>{
  const [r,p]=await Promise.all([readFile(route,'utf8'),readFile(present,'utf8')]);
  expect(r).toContain('horizon_days:r.horizon_days');
  expect(r).toContain('promotion_gate:r.promotion_gate');
  expect(r).toContain('canonical_result_id=await fingerprint(route,data)');
  expect(p).toContain("managed=new Set([");
  expect(p).toContain("'collector_model_health'");
  expect(p).toContain('recordParity(b,routed,p)');
});
