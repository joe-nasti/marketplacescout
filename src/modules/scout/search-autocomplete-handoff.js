let installed=false;

function field(){return document.getElementById('cxParitySearch')}
function currentRenderedName(event){return String(event?.detail?.name||'').trim()}
function composableValue(value,name){
  const raw=String(value||'');
  if(!name)return'';
  const lower=raw.toLowerCase(),prefix=`${name.toLowerCase()} `;
  if(!lower.startsWith(prefix))return'';
  return raw;
}

function chooseSuggestion(event){
  const button=event.target?.closest?.('#cxGlobalSuggest [data-global-card]');
  if(!button)return;
  const input=field(),name=String(button.dataset.globalCard||'').trim();
  if(!input||!name)return;

  event.preventDefault();
  event.stopImmediatePropagation();

  // Selecting a card name should be the start of a composable query, not the
  // terminal action. Put the canonical name in the field immediately and leave
  // a trailing space so the next keystroke can be s:, cn:, f:, etc.
  input.value=`${name} `;
  input.focus();
  input.setSelectionRange?.(input.value.length,input.value.length);
  document.getElementById('cxGlobalSuggest')?.remove();
  void window.CollectishScoutGlobalSearch?.loadCard?.(name);
}

function preserveComposition(event){
  const input=field(),name=currentRenderedName(event);
  if(!input||!name)return;
  const desired=composableValue(input.value,name);
  if(!desired)return;

  // search.js finishes renderGlobal() and then canonicalizes the field back to
  // only the card name. Defer one microtask so a user-entered power-search
  // suffix wins over that late async write.
  queueMicrotask(()=>{
    const live=field();
    if(!live)return;
    if(live.value===name||live.value.trim()===name) {
      live.value=desired;
      live.setSelectionRange?.(desired.length,desired.length);
    }
  });
}

export function installScoutAutocompleteHandoff(){
  if(installed)return;
  installed=true;
  document.addEventListener('click',chooseSuggestion,true);
  document.addEventListener('collectish:scout-global-rendered',preserveComposition);
}

installScoutAutocompleteHandoff();
