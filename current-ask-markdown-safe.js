// Ask Collectish safe Markdown renderer — persistent message-container binding.
(() => {
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inline(s){
    let x=esc(s);
    x=x.replace(/`([^`]+)`/g,'<code>$1</code>');
    x=x.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    x=x.replace(/__([^_]+)__/g,'<strong>$1</strong>');
    x=x.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
    x=x.replace(/(^|[^_])_([^_\n]+)_(?!_)/g,'$1<em>$2</em>');
    x=x.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
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
      if((m=/^\s*#{1,4}\s+(.+)$/.exec(line))){close();const n=Math.min(4,(line.match(/^\s*(#+)/)?.[1]?.length||2));out.push(`<h${n}>${inline(m[1])}</h${n}>`);continue}
      if((m=/^\s*>\s+(.+)$/.exec(line))){close();out.push(`<blockquote>${inline(m[1])}</blockquote>`);continue}
      if((m=/^\s*[-*]\s+(.+)$/.exec(line))){if(list!=='ul'){close();list='ul';out.push('<ul>')}out.push(`<li>${inline(m[1])}</li>`);continue}
      if((m=/^\s*\d+[.)]\s+(.+)$/.exec(line))){if(list!=='ol'){close();list='ol';out.push('<ol>')}out.push(`<li>${inline(m[1])}</li>`);continue}
      close();out.push(`<p>${inline(line)}</p>`);
    }
    close();return out.join('');
  }
  function renderElement(el){
    if(!el||el.dataset?.md==='1')return el;
    const text=el.textContent||'';
    // Assistant answers should always use the Markdown renderer; plain prose simply becomes <p>.
    el.innerHTML=markdown(text);
    el.dataset.md='1';
    return el;
  }
  function render(){
    document.querySelectorAll('#cxAskMessages .cx-ask-assistant .cx-ask-msg-body:not([data-md])').forEach(renderElement);
  }
  let bound=null,observer=null;
  function bind(){
    const box=document.getElementById('cxAskMessages');
    if(!box||box===bound)return Boolean(box);
    observer?.disconnect();bound=box;
    observer=new MutationObserver(muts=>{
      for(const m of muts){
        for(const n of m.addedNodes){
          if(!(n instanceof Element))continue;
          if(n.matches?.('.cx-ask-assistant'))renderElement(n.querySelector('.cx-ask-msg-body'));
          n.querySelectorAll?.('.cx-ask-assistant .cx-ask-msg-body:not([data-md])').forEach(renderElement);
        }
      }
      render();
    });
    observer.observe(box,{childList:true,subtree:true});
    render();return true;
  }
  function schedule(){[0,50,150,400,900,1800].forEach(ms=>setTimeout(()=>{bind();render()},ms))}
  window.CollectishRenderMarkdown=renderElement;
  window.CollectishRenderAllMarkdown=render;
  document.addEventListener('collectish:ask-message-rendered',e=>{
    if(e.detail?.role==='assistant')renderElement(e.detail.element);
  });
  document.addEventListener('submit',e=>{if(e.target?.id==='cxAskForm')schedule()},true);
  document.addEventListener('click',e=>{
    if(e.target.closest?.('#cxAskInvestigate,.cx-ask-starter,.cx-v3-starter,.cx-ask-launch'))schedule();
  },true);
  document.addEventListener('collectish:ask-v3-response',schedule);
  document.addEventListener('collectish:ready',schedule);
  if(document.readyState!=='loading')schedule();
})();