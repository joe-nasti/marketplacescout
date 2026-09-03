// Ask Collectish voice capture — bounded audio, editable transcript, no automatic send.
(() => {
  const cfg=window.COLLECTISH_CONFIG||{};
  const endpoint=`${String(cfg.supabaseUrl||'').replace(/\/$/,'')}/functions/v1/ask-collectish-transcribe`;
  const button=document.getElementById('cxAskVoice');
  const input=document.getElementById('cxAskInput');
  const stateEl=document.getElementById('cxAskVoiceState');
  if(!button||!input||!stateEl)return;

  const supported=Boolean(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder&&endpoint);
  if(!supported)return;
  button.hidden=false;
  button.closest('.cx-ask-compose')?.classList.add('cx-ask-voice-ready');

  let mode='idle',stream=null,recorder=null,chunks=[],startedAt=0,timer=null,limitTimer=null,transcribeAbort=null,draftBefore='';
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const errorText=error=>{
    const name=String(error?.name||'');
    if(name==='NotAllowedError'||name==='SecurityError')return'Microphone access is off. Allow it in Collectish app permissions and try again.';
    if(name==='NotFoundError')return'No microphone was found.';
    if(name==='AbortError')return'Voice input canceled.';
    return String(error?.message||error||'Voice input failed.');
  };
  const setState=(text='',kind='')=>{
    stateEl.textContent=text;stateEl.hidden=!text;stateEl.dataset.kind=kind;
  };
  const setMode=next=>{
    mode=next;button.dataset.mode=next;
    button.setAttribute('aria-label',next==='recording'?'Stop recording':next==='transcribing'?'Cancel transcription':'Start voice input');
    button.title=button.getAttribute('aria-label');
    input.setAttribute('aria-busy',next==='transcribing'?'true':'false');
  };
  const elapsed=()=>Math.max(0,Math.floor((Date.now()-startedAt)/1000));
  const clock=()=>{if(mode==='recording')setState(`Listening… ${Math.floor(elapsed()/60)}:${String(elapsed()%60).padStart(2,'0')} · tap the mic to finish`,'recording')};
  const clearTimers=()=>{if(timer)clearInterval(timer);if(limitTimer)clearTimeout(limitTimer);timer=null;limitTimer=null};
  const stopTracks=()=>{stream?.getTracks?.().forEach(track=>track.stop());stream=null};
  const reset=()=>{clearTimers();stopTracks();recorder=null;chunks=[];setMode('idle')};
  const bestMime=()=>['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported?.(type))||'';
  const extension=mime=>mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':mime.includes('wav')?'wav':'webm';

  async function transcribe(blob){
    const token=session()?.token;
    if(!token)throw Error('Sign in to use voice input.');
    setMode('transcribing');setState('Recognizing MTG names…','transcribing');
    transcribeAbort=new AbortController();
    const timeout=setTimeout(()=>transcribeAbort?.abort('timeout'),45000);
    const form=new FormData();
    form.append('file',blob,`collectish-voice.${extension(blob.type)}`);
    form.append('client','web');
    form.append('context',JSON.stringify(window.AskCollectish?.getContext?.()||{}));
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,signal:transcribeAbort.signal});
      const raw=await response.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
      if(!response.ok)throw Error(data?.error||`Voice transcription HTTP ${response.status}`);
      const text=String(data?.text||'').trim();if(!text)throw Error('I could not hear a question. Try again a little closer to the microphone.');
      input.value=[draftBefore.trim(),text].filter(Boolean).join(draftBefore.trim()?' ':'');
      input.dispatchEvent(new Event('input',{bubbles:true}));
      setState('Voice draft ready · review, edit, then send','ready');
      input.focus();input.setSelectionRange(input.value.length,input.value.length);
    }finally{clearTimeout(timeout);transcribeAbort=null;setMode('idle')}
  }

  async function start(){
    draftBefore=input.value;
    setState('Requesting microphone…');
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      const mimeType=bestMime();recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);chunks=[];
      recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data)};
      recorder.onerror=event=>{setState(errorText(event.error),'error');reset()};
      recorder.onstop=async()=>{
        clearTimers();stopTracks();
        const blob=new Blob(chunks,{type:recorder?.mimeType||mimeType||'audio/webm'});chunks=[];recorder=null;
        if(!blob.size){setState('I could not hear a question. Try again.','error');setMode('idle');return}
        try{await transcribe(blob)}catch(error){setState(errorText(error),'error');setMode('idle')}
      };
      recorder.start(250);startedAt=Date.now();setMode('recording');clock();timer=setInterval(clock,1000);limitTimer=setTimeout(()=>stop(),90000);
    }catch(error){reset();setState(errorText(error),'error')}
  }
  function stop(){if(mode==='recording'&&recorder?.state!=='inactive'){setState('Finishing recording…');recorder.stop()}}
  function cancel(){
    if(mode==='transcribing'){transcribeAbort?.abort();setState('Voice input canceled.');setMode('idle');return}
    if(mode==='recording'){recorder.onstop=null;try{recorder.stop()}catch{}reset();setState('Voice input canceled.')}
  }
  function toggle(){if(mode==='idle')void start();else if(mode==='recording')stop();else cancel()}
  button.addEventListener('click',toggle);
  document.addEventListener('collectish:ask-closed',cancel);
})();
