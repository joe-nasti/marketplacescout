import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ownershipPath=path.join(process.cwd(),'src/modules/seller/inventory-vnext-ownership.js');
const rendererPath=path.join(process.cwd(),'src/modules/seller/inventory.js');

test('Inventory vNext keeps a late legacy workspace render hidden while Scan owns the page',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    const host=document.createElement('section');
    host.id='cxInventory';
    host.className='cx-iv-scan-mode';
    const vnext=document.createElement('section');vnext.id='cxInventoryVnext';
    const workspace=document.createElement('section');workspace.id='cxInventoryWorkspace';
    host.append(vnext,workspace);document.body.append(host);
  });
  const ownershipSource=await readFile(ownershipPath,'utf8');
  await page.addScriptTag({content:ownershipSource});
  await expect.poll(()=>page.$eval('#cxInventoryWorkspace',el=>el.hidden)).toBe(true);

  await page.evaluate(()=>{
    const workspace=document.getElementById('cxInventoryWorkspace');
    workspace.hidden=false;
    document.dispatchEvent(new CustomEvent('collectish:inventory-workspace-rendered'));
  });
  await expect.poll(()=>page.$eval('#cxInventoryWorkspace',el=>el.hidden)).toBe(true);

  await page.evaluate(()=>{
    document.getElementById('cxInventory').classList.remove('cx-iv-scan-mode');
    document.dispatchEvent(new CustomEvent('collectish:inventory-workspace-rendered'));
  });
  await expect.poll(()=>page.$eval('#cxInventoryWorkspace',el=>el.hidden)).toBe(false);
});

test('legacy Inventory renderer writes only inside its dedicated workspace root',async()=>{
  const source=await readFile(rendererPath,'utf8');
  expect(source).toContain('function ensureInventoryChrome(pageHost)');
  expect(source).toContain("workspace.id='cxInventoryWorkspace'");
  expect(source).toContain('workspace.innerHTML=');
  expect(source).not.toContain('pageHost.innerHTML=');
});
