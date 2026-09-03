// Ask Collectish voice capture — bounded audio, editable transcript, no automatic send.
(() => {
  const cfg=window.COLLECTISH_CONFIG||{};
  const endpoint=`${String(cfg.supabaseUrl||'').replace(/\/$/,'')}/functions/v1/ask-collectish-transcribe`;
  const button=document.getElementById('cxAskVoice');
  const input=document.getElementById('cxAskInput');
  const stateEl=document.getElementById('cxAskVoiceState');
  const capture=document.getElementById('cxAskVoiceCapture');
  const cancelButton=document.getElementById('cxAskVoiceCancel');
  const finishButton=document.getElementById('cxAskVoiceFinish');
  const canvas=document.getElementById('cxAskVoiceWave');
  const timerEl=document.getElementById('cxAskVoiceTimer');
  if(!button||!input||!stateEl||!capture||!cancelButton||!finishButton||!canvas||!timerEl)return;

  const supported=Boolean(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder&&endpoint);
  if(!supported)return;
  button.hidden=false;
  button.closest('.cx-ask-compose')?.classList.add('cx-ask-voice-ready');

  let mode='idle',stream=null,recorder=null,chunks=[],startedAt=0,timer=null,limitTimer=null,transcribeAbort=null,draftBefore='';
  let audioContext=null,analyser=null,sourceNode=null,meterFrame=null,heardInput=false,lastWaveSampleAt=0;
  const WAVEFORM_POINTS=42,WAVEFORM_SAMPLE_MS=120;
  const waveform=Array(WAVEFORM_POINTS).fill(.08);
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const errorText=error=>{
    const name=String(error?.name||'');
    if(name==='NotAllowedError'||name==='SecurityError')return'Microphone access is off. Allow it in Collectish app permissions and try again.';
    if(name==='NotFoundError')return'No microphone was found.';
    if(name==='NotReadableError'||name==='TrackStartError')return'Android could not open the microphone. Close other apps using it, make sure system Microphone access is on, then try again.';
    if(name==='AbortError')return'Voice input canceled.';
    return String(error?.message||error||'Voice input failed.');
  };
  const setState=(text='',kind='')=>{
    stateEl.textContent=text;stateEl.hidden=!text;stateEl.dataset.kind=kind;
  };
  const setMode=next=>{
    mode=next;button.dataset.mode=next;
    button.closest('.cx-ask-compose')?.classList.toggle('cx-ask-recording',next==='recording');
    capture.hidden=next!=='recording';
    button.setAttribute('aria-label',next==='recording'?'Stop recording':next==='transcribing'?'Cancel transcription':'Start voice input');
    button.title=button.getAttribute('aria-label');
    input.setAttribute('aria-busy',next==='transcribing'?'true':'false');
  };
  const elapsed=()=>Math.max(0,Math.floor((Date.now()-startedAt)/1000));
  const timeLabel=()=>`${Math.floor(elapsed()/60)}:${String(elapsed()%60).padStart(2,'0')}`;
  const clock=()=>{if(mode==='recording'){timerEl.textContent=timeLabel();setState(!heardInput&&elapsed()>=3?'I’m not hearing anything · check your microphone':'Listening…','recording')}};
  const clearTimers=()=>{if(timer)clearInterval(timer);if(limitTimer)clearTimeout(limitTimer);timer=null;limitTimer=null};
  const stopMeter=()=>{if(meterFrame)cancelAnimationFrame(meterFrame);meterFrame=null;try{sourceNode?.disconnect()}catch{}sourceNode=null;analyser=null;if(audioContext){void audioContext.close?.().catch?.(()=>{})}audioContext=null};
  const stopTracks=()=>{stopMeter();stream?.getTracks?.().forEach(track=>track.stop());stream=null};
  const reset=()=>{clearTimers();stopTracks();recorder=null;chunks=[];setMode('idle')};
  const haptic=pattern=>{try{navigator.vibrate?.(pattern)}catch{}}
  const drawWaveform=()=>{
    const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio||1,2),width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
    const context=canvas.getContext('2d');if(!context)return;
    context.clearRect(0,0,width,height);context.fillStyle=getComputedStyle(canvas).color;
    const gap=2.5*scale,barWidth=Math.max(1.5*scale,(width-gap*(waveform.length-1))/waveform.length);
    waveform.forEach((level,index)=>{const barHeight=Math.max(2*scale,Math.min(height*.9,level*height));context.fillRect(index*(barWidth+gap),(height-barHeight)/2,barWidth,barHeight)});
  };
  const renderMeter=timestamp=>{
    if(mode!=='recording'||!analyser)return;
    const data=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);
    let energy=0;for(const sample of data){const normalized=(sample-128)/128;energy+=normalized*normalized}
    const level=Math.min(1,Math.sqrt(energy/data.length)*4.2);if(level>.08)heardInput=true;
    if(!lastWaveSampleAt||timestamp-lastWaveSampleAt>=WAVEFORM_SAMPLE_MS){waveform.push(Math.max(.06,level));waveform.shift();drawWaveform();lastWaveSampleAt=timestamp}
    meterFrame=requestAnimationFrame(renderMeter);
  };
  const startMeter=async activeStream=>{
    heardInput=false;lastWaveSampleAt=0;waveform.fill(.08);drawWaveform();
    const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;
    try{audioContext=new AudioContext();await audioContext.resume?.();sourceNode=audioContext.createMediaStreamSource(activeStream);analyser=audioContext.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.72;sourceNode.connect(analyser);meterFrame=requestAnimationFrame(renderMeter)}catch{stopMeter()}
  };
  const bestMime=()=>['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported?.(type))||'';
  const extension=mime=>mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':mime.includes('wav')?'wav':'webm';
  const openMicrophone=async()=>{
    try{
      return await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:{ideal:true},noiseSuppression:{ideal:true},autoGainControl:{ideal:true}},video:false});
    }catch(error){
      const terminal=['NotAllowedError','SecurityError','NotFoundError','AbortError'].includes(String(error?.name||''));
      if(terminal)throw error;
      return navigator.mediaDevices.getUserMedia({audio:true,video:false});
    }
  };

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
      stream=await openMicrophone();
      const mimeType=bestMime();recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);chunks=[];
      recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data)};
      recorder.onerror=event=>{setState(errorText(event.error),'error');reset()};
      recorder.onstop=async()=>{
        clearTimers();stopTracks();
        const blob=new Blob(chunks,{type:recorder?.mimeType||mimeType||'audio/webm'});chunks=[];recorder=null;
        if(!blob.size){setState('I could not hear a question. Try again.','error');setMode('idle');return}
        try{await transcribe(blob)}catch(error){setState(errorText(error),'error');setMode('idle')}
      };
      recorder.start(250);startedAt=Date.now();setMode('recording');await startMeter(stream);clock();timer=setInterval(clock,250);limitTimer=setTimeout(()=>stop(),90000);haptic(12);
    }catch(error){reset();setState(errorText(error),'error')}
  }
  function stop(){if(mode==='recording'&&recorder?.state!=='inactive'){setState('Finishing recording…');haptic([10,25,10]);recorder.stop()}}
  function cancel(){
    if(mode==='transcribing'){transcribeAbort?.abort();setState('Voice input canceled.');setMode('idle');return}
    if(mode==='recording'){recorder.onstop=null;try{recorder.stop()}catch{}reset();setState('Voice input canceled.')}
  }
  function toggle(){if(mode==='idle')void start();else if(mode==='recording')stop();else cancel()}
  button.addEventListener('click',toggle);
  finishButton.addEventListener('click',stop);
  cancelButton.addEventListener('click',cancel);
  input.addEventListener('input',()=>{if(mode==='idle'&&stateEl.dataset.kind==='ready')setState()});
  document.addEventListener('collectish:ask-sent',()=>{if(mode==='idle')setState()});
  document.addEventListener('collectish:ask-closed',cancel);
})();
