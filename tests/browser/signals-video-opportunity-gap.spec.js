import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('creator catalyst gap remains a presentation-only empirical layer',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const sql=await read('cloud-worker/video-expected-reaction-gap.sql');
  const ui=await read('src/modules/signals/video-events-ui.js');
  expect(sql).toContain('market_intel_video_outcome_cohorts');
  expect(sql).toContain('market_intel_video_opportunity_gap');
  expect(sql).toContain('prior_expected_reaction_score');
  expect(sql).toContain('cohort_mature_signals');
  expect(sql).toContain("'prior_only'");
  expect(sql).toContain('unpriced_catalyst_gap_score');
  expect(sql).not.toContain('promoted_score');
  expect(sql).not.toContain('promoted_grade');
  expect(ui).toContain('Expected reaction / unpriced gap');
  expect(ui).toContain('market_intel_video_opportunity_gap');
  expect(ui).toContain('prior-driven');
  expect(ui).toContain('never changes Scout grade');
});
