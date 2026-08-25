const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const LABELS=new Set(['SHORT ANSWER','VERDICT','CONFIDENCE','THESIS','EVIDENCE','KEY EVIDENCE','RISKS','DATA QUALITY','ENTRY','EXIT','EXIT / TARGET','TARGET','POSITION SIZE','CORE SETUP','COVERAGE','GAPS']);
const SECTION_RE=/^(?:KEY\s+)?EVIDENCE(?:\s*\([^)]*\))?$|^THESIS$|^RISKS?$|^DATA QUALITY$|^ENTRY$|^EXIT(?: \/ TARGET)?$|^POSITION SIZE$|^CORE SETUP$|^COVERAGE$|^GAPS$/i;

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
  return {label,html:`<p class="cx-md-labeled"><strong>${inline(m[1].trim())}:</strong> ${inline(m[2].trim())}</p>`};
}

function sectionHeading(text){
  const clean=String(text||'').trim().replace(/:$/,'');
  return SECTION_RE.test(clean)?clean:null;
}

export function markdown(src){
  const lines=String(src??'').replace(/\r\n?/g,'\n').split('\n');
  const out=[];let list=null,section='',evidenceRank=0;
  const close=()=>{if(list){out.push(`</${list}>`);list=null}};
  const setSection=s=>{section=String(s||'').toUpperCase();if(/EVIDENCE/.test(section))evidenceRank=0};
  for(const raw of lines){
    const line=raw.trimEnd();
    if(/^\s*$/.test(line)){close();continue}
    if(/^\s*---+\s*$/.test(line)){close();out.push('<hr>');continue}
    let m;
    if((m=/^\s*#{1,4}\s+(.+)$/.exec(line))){
      close();const title=m[1].trim();setSection(title);const n=Math.min(4,(line.match(/^\s*(#+)/)?.[1]?.length||2));out.push(`<h${n}>${inline(title)}</h${n}>`);continue;
    }
    const plainSection=sectionHeading(line);
    if(plainSection){close();setSection(plainSection);out.push(`<h2 class="cx-md-section">${inline(plainSection)}</h2>`);continue}
    if((m=/^\s*>\s+(.+)$/.exec(line))){close();out.push(`<blockquote>${inline(m[1])}</blockquote>`);continue}
    if((m=/^\s*[-*•]\s+(.+)$/.exec(line))){if(list!=='ul'){close();list='ul';out.push('<ul>')}out.push(`<li>${inline(m[1])}</li>`);continue}
    if((m=/^\s*\d+[.)]\s+(.+)$/.exec(line))){
      if(/EVIDENCE/.test(section)){
        close();evidenceRank++;out.push(`<div class="cx-md-evidence-title"><span class="cx-md-rank">${evidenceRank}</span><strong>${inline(m[1])}</strong></div>`);continue;
      }
      if(list!=='ol'){close();list='ol';out.push('<ol>')}out.push(`<li>${inline(m[1])}</li>`);continue;
    }
    const label=labeled(line);if(label){close();if(/EVIDENCE/.test(label.label))setSection(label.label);out.push(label.html);continue}
    if((m=/^\s*(Short answer)\s*[—-]\s*(.+)$/i.exec(line))){close();out.push(`<p class="cx-md-short"><strong>${inline(m[1])}</strong><span>${inline(m[2])}</span></p>`);continue}
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

export function createProgressiveMarkdownRenderer(el,initial=''){
  let text=String(initial||''),queued='',frame=0,closed=false;
  const flush=()=>{
    frame=0;
    if(closed||!el)return;
    if(queued){text+=queued;queued=''}
    renderMarkdownElement(el,text);
    const host=el.closest?.('.cx-ask-messages');if(host)host.scrollTop=host.scrollHeight;
  };
  const schedule=()=>{if(!frame&&!closed)frame=requestAnimationFrame(flush)};
  return {
    append(delta){if(closed||!delta)return;text+=String(delta);schedule()},
    replace(next){if(closed)return;text=String(next||'');queued='';schedule()},
    flush(){if(frame){cancelAnimationFrame(frame);frame=0}flush();return text},
    close(){if(closed)return text;if(frame){cancelAnimationFrame(frame);frame=0}flush();closed=true;return text},
    text(){return text}
  };
}

// Keep every Ask surface on the same Markdown implementation. The global Ask
// panel is shared across Scout, Seller, SYP, Inventory, Vendors and Admin; all
// assistant text must flow through this renderer regardless of active tab.
window.CollectishMarkdown={render:renderMarkdownElement,toHtml:markdown,createStream:createProgressiveMarkdownRenderer};
window.CollectishRenderMarkdown=renderMarkdownElement;