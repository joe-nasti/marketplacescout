import{test,expect}from'@playwright/test';
import{readFile}from'node:fs/promises';

test('Signals source collectors mount outside the hidden legacy workspace',async()=>{
  const source=await readFile('src/modules/signals/source-collectors.js','utf8');
  expect(source).toContain("document.getElementById('cxSignalsNav')");
  expect(source).toContain("toggle.id='cxSignalsSources'");
  expect(source).toContain("toggle.setAttribute('aria-controls','cxSourceCollectors')");
  expect(source).toContain("wrap.hidden=true");
  expect(source).not.toContain("document.getElementById('cxRenderedIntel')||page?.querySelector('.cx-signal-analyze')");
});

test('Sources remains a utility control rather than a sixth intelligence view',async()=>{
  const source=await readFile('src/modules/signals/index.js','utf8');
  expect(source).toContain("const SIGNAL_VIEWS=['scan','discovery','competitive','commander','secret-lair']");
  expect(source).not.toContain("data-signals-mode=\"sources\"");
});
