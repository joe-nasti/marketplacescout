const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const LABELS=new Set(['SHORT ANSWER','VERDICT','CONFIDENCE','THESIS','EVIDENCE','RISKS','DATA QUALITY','ENTRY','EXIT','EXIT / TARGET','TARGET','POSITION SIZE','CORE SETUP','COVERAGE','GAPS']);

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

function labeled(line){
  const m=/^\s*([^:]{2,28})\s*:\s*(.+)$/.exec(line);
  if(!m)return null;
  const label=m[1].trim().toUpperCase();
  if(!LABELS.has(label))return null;
  return `<p><strong>${inline(m[1].trim())}:</strong> ${inline(m[2].trim())}</p>`;
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
    if((m=/^\s*[-*•]\s+(.+)$/.exec(line))){if(list!=='ul'){close();list='ul';out.push('<ul>')}out.push(`<li>${inline(m[1])}</li>`);continue}
    if((m=/^\s*\d+[.)]\s+(.+)$/.exec(line))){if(list!=='ol'){close();list='ol';out.push('<ol>')}out.push(`<li>${inline(m[1])}</li>`);continue}
    const label=labeled(line);if(label){close();out.push(label);continue}
    if((m=/^\s*(Short answer)\s*[—-]\s*(.+)$/i.exec(line))){close();out.push(`<p><strong>${inline(m[1])}</strong> — ${inline(m[2])}</p>`);continue}
    close();out.push(`<p>${inline(line)}</p>`);
  }
  close();return out.join('');
}

export function renderMarkdownElement(el,text=el?.textContent||''){
  if(!el)return el;
  el.innerHTML=markdown(text);
  el.dataset.md='1';
  return el;
}

// Keep every Ask surface on the same Markdown implementation. The global Ask
// panel is shared across Scout, Seller, SYP, Inventory, Vendors and Admin; all
// assistant text must flow through this renderer regardless of active tab.
window.CollectishMarkdown={render:renderMarkdownElement,toHtml:markdown};
window.CollectishRenderMarkdown=renderMarkdownElement;
