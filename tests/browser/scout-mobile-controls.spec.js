import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Scout saved views stay separate from the Filters trigger',async()=>{
  const source=await read('src/modules/scout/renderer.js');
  const start=source.indexOf('cx-scout-saved-views');
  const end=source.indexOf('</div></div><button type="button" id="cxScoutBudgetStrip"',start);
  const chrome=start>=0&&end>start?source.slice(start,end):'';
  expect(chrome).toContain('Top');
  expect(chrome).toContain('Quick turns');
  expect(chrome).toContain('Buylist backed');
  expect(chrome).toContain('High velocity');
  expect(chrome).not.toContain('data-scout-filters');
  expect(source).toContain('data-scout-filters>Filters');
});

test('mobile build badge and theme toggle live in the revealable app utility shelf',async()=>{
  const [shell,theme,origin,css]=await Promise.all([
    read('src/core/shell.js'),
    read('src/core/theme.js'),
    read('src/core/mobile-utility-origin.js'),
    read('src/styles/utility-controls.css')
  ]);
  expect(shell).toContain('id="cxMobileUtilities"');
  expect(shell).toContain('<div class="cx-top-version">web ${WEB_VERSION}</div>');
  expect(theme).toContain("if(mobile.matches)return document.getElementById('cxMobileUtilities')");
  expect(theme).toContain("return document.getElementById('cxDesktopUtilities')");
  expect(theme).toContain('host.appendChild(button)');
  expect(origin).toContain('shelfIsPartlyRevealed');
  expect(origin).toContain('scheduleShelfSnap');
  expect(origin).toContain("setTimeout(()=>alignToOrigin({force:true,behavior:'smooth'}),160)");
  expect(css).toContain('.cx-mobile-utilities{display:none}');
  expect(css).toContain('.cx-mobile-utilities{display:flex');
  expect(css).toContain('.cx-desktop-utilities{display:none}');
});
