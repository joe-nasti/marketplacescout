import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Scout opportunity context unifies Signals and creator catalyst without grade mutation',async()=>{
  const [ui,sql]=await Promise.all([
    read('src/modules/signals/scout-badges.js'),
    read('cloud-worker/scout-opportunity-context.sql')
  ]);
  expect(ui).toContain('scout_opportunity_context?select=');
  expect(ui).toContain('Sort within grade + context');
  expect(ui).toContain('Opportunity context');
  expect(ui).toContain('context_priority_boost');
  expect(ui).toContain('unpriced_catalyst_gap_score');
  expect(ui).toContain('priority/urgency only · grade unchanged');
  expect(sql).toContain('market_intel_scout_confidence_sku');
  expect(sql).toContain('market_intel_video_opportunity_gap');
  expect(sql).toContain("when b.promoted_grade not in ('A','B') then 0");
  expect(sql).toContain("case when s.promoted_grade in ('A','B') then least(12");
  expect(sql).toContain("then 'act_now'");
  expect(sql).toContain("then 'confirmed_late'");
  expect(sql).toContain("then 'printing_specific'");
  expect(sql).toContain("coalesce(p.printing_demand_class,'')<>'thin_print_anomaly'");
  expect(sql).toContain('does not change Scout grade or economics');
});
