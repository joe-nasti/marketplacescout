import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('ACR native booster rollout is exact-identity and fingerprint gated',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const [worker,workflow,migration]=await Promise.all([
    readFile('cloud-worker/mtgjson-native-booster-backtest.py','utf8'),
    readFile('.github/workflows/mtgjson-sync.yml','utf8'),
    readFile('supabase/migrations/20260902211500_verify_acr_native_boosters.sql','utf8')
  ]);
  expect(worker).toContain("x.get('code')");
  expect(worker).toContain("booster_code=='default'");
  expect(worker).toContain("adapter='beyond_booster_mtgjson_v1'");
  expect(workflow).toContain('MTGJSON_NATIVE_BOOSTER_SETS: CMM,ACR');
  expect(workflow).toContain('draft,set,collector,collector-sample,default');
  expect(migration).toContain('9812dcb8ef58a98a796a7d293a408eca');
  expect(migration).toContain('8e64d7fe03edf351e8a9337cbb6b77f2');
  expect(migration).toContain('collecting-assassins-creed');
});
