import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const consoleSource=await readFile(new URL('../../src/modules/admin/console.js',import.meta.url),'utf8');

test('Admin refreshes do not change selected tab or Sealed subview or destroy CardTrader child UI',async({page})=>{
  await page.setContent('<main id="cxAdmin" class="active"></main>');
  await page.addScriptTag({content:`window.rest=async()=>[];${consoleSource}`});
  await page.evaluate(async()=>{
    window.CollectishAdminConsole.render();
    window.CollectishAdminConsole.show('sealed',false);
    window.CollectishAdminConsole.setSealedView('catalog');
    const catalog=document.createElement('section');catalog.id='cxAdminSealedCatalog';document.querySelector('[data-admin-panel="sealed"]').appendChild(catalog);
    window.CollectishAdminConsole.setSealedView('catalog');
    const child=document.createElement('section');child.id='cxAdminCardTraderHealth';document.getElementById('cxAdminSealedSources').prepend(child);
    await window.CollectishAdminConsole.refresh();
    await window.CollectishAdminConsole.refresh();
    document.dispatchEvent(new CustomEvent('collectish:runtime-health'));
    await new Promise(r=>setTimeout(r,80));
  });
  await expect(page.locator('[data-admin-tab="sealed"]')).toHaveClass(/active/);
  await expect(page.locator('#cxAdminSealedCatalog')).not.toHaveAttribute('hidden','');
  await expect(page.locator('#cxAdminSealedSources')).toHaveAttribute('hidden','');
  await expect(page.locator('#cxAdminCardTraderHealth')).toHaveCount(1);
});
