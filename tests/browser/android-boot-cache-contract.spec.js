import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=file=>readFile(path.join(process.cwd(),file),'utf8');

test('Android boot does not block or cache-bust the hashed application entry',async()=>{
  const index=await read('index.html');
  expect(index).toContain("void clearNativeWorkerState()");
  expect(index).toContain("await import('./src/main.js')");
  expect(index).not.toContain('src/main.js?boot=${nonce}');
  expect(index).not.toContain('await clearNativeWorkerState()');
});

test('Android reuses hosted assets and defers competing background loads',async()=>{
  const source=await read('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt');
  const onCreate=source.slice(source.indexOf('override fun onCreate'),source.indexOf('override fun onSaveInstanceState'));
  expect(source).toContain('WebSettings.LOAD_DEFAULT');
  expect(source).toContain('private fun startHostedBackgroundWork()');
  expect(source).toContain('}, 1_500L)');
  expect(onCreate).not.toContain('seller.loadUrl("https://sellerportal.tcgplayer.com/")');
  expect(onCreate).not.toContain('startForegroundService(syncIntent)');
});
