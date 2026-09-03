import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('new randomized sealed products expose honest release-price stress',async()=>{
  const ui=await readFile('src/modules/sealed/renderer.js','utf8');
  for(const label of ['Release-price stress','20% compression','35% compression','50% compression','max buy for 15% ROI'])expect(ui).toContain(label);
  expect(ui).toContain("ageDays>90");
  expect(ui).toContain("includes('randomized')");
  expect(ui).toContain('They are not forecasts and do not change the Scout grade');
  expect(ui).toContain('calibrated stabilized EV remains gated');
});
