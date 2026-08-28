import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const moduleText=fs.readFileSync(new URL('../../src/modules/signals/scout-synergy-opportunities.js', import.meta.url),'utf8');
const sqlText=fs.readFileSync(new URL('../../cloud-worker/synergy-delayed-reaction.sql', import.meta.url),'utf8');

test('Scout synergy lifecycle exposes delayed reaction states without changing grade', async () => {
  expect(sqlText).toContain("still_unpriced_24h");
  expect(sqlText).toContain("still_unpriced_72h");
  expect(sqlText).toContain("still_unpriced_7d");
  expect(sqlText).toContain("starting_to_react");
  expect(sqlText).toContain("market_caught_up");
  expect(sqlText).toContain('security_invoker=true');
  expect(moduleText).toContain('market_intel_scout_synergy_lifecycle');
  expect(moduleText).toContain('Still unpriced 24h+');
  expect(moduleText).toContain('Scout grade unchanged');
  expect(moduleText).toContain('lifecycle_priority_score');
});
