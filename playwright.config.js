import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/browser',
  timeout:30_000,
  expect:{timeout:8_000},
  fullyParallel:false,
  reporter:[['list'],['html',{outputFolder:'playwright-report',open:'never'}]],
  use:{
    baseURL:'http://127.0.0.1:4173',
    trace:'retain-on-failure',
    screenshot:'only-on-failure',
    video:'retain-on-failure'
  },
  webServer:{
    command:'npm run build && npm run preview -- --host 127.0.0.1',
    url:'http://127.0.0.1:4173',
    reuseExistingServer:!process.env.CI,
    timeout:120_000
  },
  projects:[
    {name:'desktop-chromium',use:{...devices['Desktop Chrome']}},
    {name:'pixel-mobile',use:{...devices['Pixel 7']}},
    {name:'narrow-mobile',use:{viewport:{width:360,height:800},deviceScaleFactor:3,isMobile:true,hasTouch:true}}
  ]
});
