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

export function markdown(src){
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

export function renderMarkdownElement(el){
  if(!el||el.dataset?.md==='1')return el;
  el.innerHTML=markdown(el.textContent||'');
  el.dataset.md='1';
  return el;
}

export function renderAllMarkdown(){
  document.querySelectorAll('#cxAskMessages .cx-ask-assistant .cx-ask-msg-body:not([data-md])').forEach(renderMarkdownElement);
}

let bound=null,observer=null;
function bindMessageContainer(){
  const box=document.getElementById('cxAskMessages');
  if(!box||box===bound)return Boolean(box);
  observer?.disconnect();
  bound=box;
  observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      for(const node of mutation.addedNodes){
        if(!(node instanceof Element))continue;
        if(node.matches?.('.cx-ask-assistant'))renderMarkdownElement(node.querySelector('.cx-ask-msg-body'));
        node.querySelectorAll?.('.cx-ask-assistant .cx-ask-msg-body:not([data-md])').forEach(renderMarkdownElement);
      }
    }
  });
  observer.observe(box,{childList:true,subtree:true});
  renderAllMarkdown();
  return true;
}

function scheduleBind(){
  [0,50,150,400,900,1800].forEach(ms=>setTimeout(()=>{bindMessageContainer();renderAllMarkdown()},ms));
}

export function installAskMarkdown(){
  window.CollectishRenderMarkdown=renderMarkdownElement;
  window.CollectishRenderAllMarkdown=renderAllMarkdown;
  document.addEventListener('collectish:ask-message-rendered',e=>{
    if(e.detail?.role==='assistant')renderMarkdownElement(e.detail.element);
  });
  document.addEventListener('submit',e=>{if(e.target?.id==='cxAskForm')scheduleBind()},true);
  document.addEventListener('click',e=>{
    if(e.target.closest?.('#cxAskInvestigate,.cx-ask-starter,.cx-v3-starter,.cx-ask-launch'))scheduleBind();
  },true);
  document.addEventListener('collectish:ask-v3-response',scheduleBind);
  document.addEventListener('collectish:ready',scheduleBind);
  if(document.readyState!=='loading')scheduleBind();
}

installAskMarkdown();
