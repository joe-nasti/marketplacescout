const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function inline(text){
  let x=escapeHtml(text);
  x=x.replace(/`([^`]+)`/g,'<code>$1</code>');
  x=x.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  x=x.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  x=x.replace(/__([^_]+)__/g,'<strong>$1</strong>');
  x=x.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
  x=x.replace(/(^|[^_])_([^_\n]+)_(?!_)/g,'$1<em>$2</em>');
  return x;
}

export function markdownToHtml(source){
  const lines=String(source??'').replace(/\r\n?/g,'\n').split('\n');
  const out=[];
  let list=null;
  const closeList=()=>{if(list){out.push(`</${list}>`);list=null}};
  for(const raw of lines){
    const line=raw.trimEnd();
    if(/^\s*$/.test(line)){closeList();continue}
    if(/^\s*---+\s*$/.test(line)){closeList();out.push('<hr>');continue}
    let m;
    if((m=/^\s*#{1,3}\s+(.+)$/.exec(line))){
      closeList();
      const level=Math.min(3,(line.match(/^\s*(#+)/)?.[1]?.length||2));
      out.push(`<h${level}>${inline(m[1])}</h${level}>`);
      continue;
    }
    if((m=/^\s*>\s?(.+)$/.exec(line))){closeList();out.push(`<blockquote>${inline(m[1])}</blockquote>`);continue}
    if((m=/^\s*[-*]\s+(.+)$/.exec(line))){
      if(list!=='ul'){closeList();list='ul';out.push('<ul>')}
      out.push(`<li>${inline(m[1])}</li>`);continue;
    }
    if((m=/^\s*\d+[.)]\s+(.+)$/.exec(line))){
      if(list!=='ol'){closeList();list='ol';out.push('<ol>')}
      out.push(`<li>${inline(m[1])}</li>`);continue;
    }
    closeList();out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

export function renderMarkdownElement(element){
  if(!element||element.dataset?.md==='1')return element;
  const text=element.textContent||'';
  if(!/[\n*_#`>\[-]/.test(text))return element;
  element.innerHTML=markdownToHtml(text);
  element.dataset.md='1';
  return element;
}

export function renderAllAskMarkdown(root=document){
  root.querySelectorAll?.('#cxAskMessages .cx-ask-assistant .cx-ask-msg-body:not([data-md])').forEach(renderMarkdownElement);
}

let messageObserver=null;
function bindMessageObserver(){
  const messages=document.getElementById('cxAskMessages');
  if(!messages||messages.dataset.cxMarkdownObserved==='1')return false;
  messages.dataset.cxMarkdownObserved='1';
  messageObserver?.disconnect();
  messageObserver=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        if(!(node instanceof Element))continue;
        if(node.matches?.('.cx-ask-assistant'))node.querySelectorAll('.cx-ask-msg-body').forEach(renderMarkdownElement);
        node.querySelectorAll?.('.cx-ask-assistant .cx-ask-msg-body').forEach(renderMarkdownElement);
      }
    }
  });
  messageObserver.observe(messages,{childList:true,subtree:true});
  renderAllAskMarkdown();
  return true;
}

export function installAskMarkdown(){
  window.CollectishRenderMarkdown=renderMarkdownElement;
  window.CollectishRenderAllMarkdown=renderAllAskMarkdown;

  document.addEventListener('collectish:ask-message-rendered',event=>{
    if(event.detail?.role==='assistant')renderMarkdownElement(event.detail.element);
  });
  document.addEventListener('collectish:ask-v3-response',()=>renderAllAskMarkdown());
  document.addEventListener('submit',event=>{
    if(event.target?.id==='cxAskForm')setTimeout(()=>{bindMessageObserver();renderAllAskMarkdown()},0);
  },true);
  document.addEventListener('click',()=>{
    if(bindMessageObserver())renderAllAskMarkdown();
  },true);

  // Bounded bootstrap only; once the Ask message container exists its scoped observer owns updates.
  [0,250,1000,2500].forEach(ms=>setTimeout(bindMessageObserver,ms));
}

installAskMarkdown();
