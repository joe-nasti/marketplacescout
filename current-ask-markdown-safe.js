// Ask Collectish safe Markdown renderer — event-driven only, no startup observer.
(() => {
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inline(s){
    let x=esc(s);
    x=x.replace(/`([^`]+)`/g,'<code>$1</code>');
    x=x.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    x=x.replace(/__([^_]+)__/g,'<strong>$1</strong>');
    x=x.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g,'<em>$1</em>');
    x=x.replace(/(?<!_)_([^_\n]+)_(?!_)/g,'<em>$1</em>');
    return x;
  }
  function markdown(src){
    const lines=String(src??'').replace(/\r\n?/g,'\n').split('\n');
    const out=[];let list=null;
    const close=()=>{if(list){out.push(`</${list}>`);list=null}};
    for(const raw of lines){
      const line=raw.trimEnd();
      if(/^\s*$/.test(line)){close();continue}
      if(/^\s*---+\s*$/.test(line)){close();out.push('<hr>');continue}
      let m;
      if((m=/^\s*#{1,3}\s+(.+)$/.exec(line))){close();const n=Math.min(3,(line.match(/^\s*(#+)/)?.[1]?.length||2));out.push(`<h${n}>${inline(m[1])}</h${n}>`);continue}
      if((m=/^\s*[-*]\s+(.+)$/.exec(line))){if(list!=='ul'){close();list='ul';out.push('<ul>')}out.push(`<li>${inline(m[1])}</li>`);continue}
      if((m=/^\s*\d+[.)]\s+(.+)$/.exec(line))){if(list!=='ol'){close();list='ol';out.push('<ol>')}out.push(`<li>${inline(m[1])}</li>`);continue}
      close();out.push(`<p>${inline(line)}</p>`);
    }
    close();return out.join('');
  }
  function renderElement(el){
    if(!el||el.dataset?.md==='1')return;
    const text=el.textContent||'';
    if(!/[\n*_#`-]/.test(text))return;
    el.innerHTML=markdown(text);
    el.dataset.md='1';
  }
  function render(){
    document.querySelectorAll('#cxAskMessages .cx-ask-assistant .cx-ask-msg-body:not([data-md])').forEach(renderElement);
  }
  function schedule(){[0,80,250,700,1500,3000,6000].forEach(ms=>setTimeout(render,ms))}
  document.addEventListener('collectish:ask-message-rendered',e=>{
    if(e.detail?.role==='assistant')renderElement(e.detail.element);
  });
  document.addEventListener('submit',e=>{if(e.target?.id==='cxAskForm')schedule()},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('#cxAskInvestigate,.cx-ask-starter,.cx-v3-starter'))schedule()},true);
  document.addEventListener('collectish:ask-v3-response',schedule);
})();
