import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Scout synergy opportunity layer keeps grade separate from catalyst discovery priority',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const sql=await read('cloud-worker/scout-synergy-opportunity-layer.sql');
  const ui=await read('src/modules/signals/scout-synergy-opportunities.js');
  const modules=await read('src/modules/index.js');
  expect(sql).toContain('market_intel_scout_synergy_opportunities');
  expect(sql).toContain('security_invoker = true');
  expect(sql).toContain('unpriced_catalyst_gap_score');
  expect(sql).toContain('synergy_priority_score');
  expect(sql).toContain('scout_grade');
  expect(ui).toContain('Unpriced synergy');
  expect(ui).toContain('Scout grade unchanged');
  expect(ui).toContain('expected_market_reaction_score');
  expect(ui).toContain('market_response_score');
  expect(ui).toContain('direct_net_profit');
  expect(modules).toContain("import('./signals/scout-synergy-opportunities.js')");
});
