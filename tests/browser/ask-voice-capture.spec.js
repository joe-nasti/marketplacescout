import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Ask voice capture creates an editable MTG-aware draft without auto-send',async()=>{
  const main=await read('src/modules/ask/main.js');
  const voice=await read('src/modules/ask/voice-capture.js');
  const modules=await read('src/modules/index.js');
  expect(main).toContain('id="cxAskVoice"');
  expect(main).toContain('id="cxAskVoiceState"');
  expect(modules).toContain("import('./ask/voice-capture.js')");
  expect(voice).toContain('navigator.mediaDevices.getUserMedia');
  expect(voice).toContain('new MediaRecorder');
  expect(voice).toContain('/functions/v1/ask-collectish-transcribe');
  expect(voice).toContain("input.value=[draftBefore.trim(),text]");
  expect(voice).toContain("Voice draft ready · review, edit, then send");
  expect(voice).not.toContain('AskCollectish.send(text)');
});

test('voice recording has explicit stop, cancellation, timeout, and close cleanup',async()=>{
  const voice=await read('src/modules/ask/voice-capture.js');
  expect(voice).toContain("next==='recording'?'Stop recording'");
  expect(voice).toContain("next==='transcribing'?'Cancel transcription'");
  expect(voice).toContain('limitTimer=setTimeout(()=>stop(),90000)');
  expect(voice).toContain("document.addEventListener('collectish:ask-closed',cancel)");
  expect(voice).toContain('transcribeAbort?.abort()');
  expect(voice).toContain('track.stop()');
});

test('transcription edge function is authenticated and supplies MTG vocabulary',async()=>{
  const fn=await read('supabase/functions/ask-collectish-transcribe/index.ts');
  expect(fn).toContain("`${U}/auth/v1/user`");
  expect(fn).toContain("upstream.append('model','gpt-transcribe')");
  expect(fn).toContain("upstream.append('keywords[]',item)");
  expect(fn).toContain("upstream.append('languages[]','en')");
  expect(fn).toContain('currently selected Collectish product');
  expect(fn).toContain("'TCGplayer'");
  expect(fn).toContain("'EDHREC'");
  expect(fn).toContain("'SYP'");
  expect(fn).toContain('MAX_BYTES=12*1024*1024');
});

test('Android hosts grant microphone capture only through runtime permission',async()=>{
  const manifest=await read('android-agent/app/src/main/AndroidManifest.xml');
  const delegate=await read('android-agent/app/src/main/java/com/collectish/agent/MicrophonePermissionDelegate.kt');
  const main=await read('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt');
  const deepLink=await read('android-agent/app/src/main/java/com/collectish/agent/DeepLinkActivity.kt');
  expect(manifest).toContain('android.permission.RECORD_AUDIO');
  expect(delegate).toContain('PermissionRequest.RESOURCE_AUDIO_CAPTURE');
  expect(delegate).toContain('Manifest.permission.RECORD_AUDIO');
  expect(delegate).toContain('request.deny()');
  expect(main).toContain('microphonePermission.handle(request)');
  expect(deepLink).toContain('microphonePermission.handle(request)');
});

test('recorded audio becomes an editable composer draft in the browser',async({page})=>{
  const voice=await read('src/modules/ask/voice-capture.js');
  await page.route('**/__voice-harness',route=>route.fulfill({contentType:'text/html',body:'<form class="cx-ask-compose"><button id="cxAskVoice" type="button" hidden></button><textarea id="cxAskInput">price check</textarea><div id="cxAskVoiceState" hidden></div></form>'}));
  await page.goto('/__voice-harness');
  await page.evaluate(()=>{
    localStorage.setItem('collectishSession',JSON.stringify({token:'test-token'}));
    window.COLLECTISH_CONFIG={supabaseUrl:'https://collectish.test'};
    window.AskCollectish={getContext:()=>({screen:'scout',product_name_hint:'Optimus Prime, Hero'})};
    window.__voiceProbe={stopped:false,authorization:null,context:null};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){window.__voiceProbe.stopped=true}}]})}});
    window.MediaRecorder=class {
      static isTypeSupported(){return true}
      constructor(_stream,options){this.mimeType=options?.mimeType||'audio/webm';this.state='inactive'}
      start(){this.state='recording';this.ondataavailable?.({data:new Blob(['audio'],{type:this.mimeType})})}
      stop(){this.state='inactive';this.onstop?.()}
    };
    window.fetch=async(_url,options)=>{
      window.__voiceProbe.authorization=options.headers.Authorization;
      window.__voiceProbe.context=options.body.get('context');
      return new Response(JSON.stringify({ok:true,text:'What is the TCGplayer Direct Low for Optimus Prime, Hero?'}),{status:200,headers:{'Content-Type':'application/json'}});
    };
  });
  await page.addScriptTag({content:voice});
  const mic=page.locator('#cxAskVoice');
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(mic).toHaveAttribute('aria-label','Stop recording');
  await mic.click();
  await expect(page.locator('#cxAskInput')).toHaveValue('price check What is the TCGplayer Direct Low for Optimus Prime, Hero?');
  await expect(page.locator('#cxAskVoiceState')).toContainText('review, edit, then send');
  const probe=await page.evaluate(()=>window.__voiceProbe);
  expect(probe.stopped).toBe(true);
  expect(probe.authorization).toBe('Bearer test-token');
  expect(JSON.parse(probe.context).product_name_hint).toBe('Optimus Prime, Hero');
});
