const KEY='collectishTheme';
const MODES=['system','light','dark'];
const media=matchMedia('(prefers-color-scheme: dark)');

export const savedThemeMode=()=>{
  const value=localStorage.getItem(KEY);
  return MODES.includes(value)?value:'system';
};

export const resolvedTheme=mode=>mode==='system'?(media.matches?'dark':'light'):mode;

function syncNative(theme){
  try{window.CollectishAndroid?.setTheme?.(theme)}catch{}
}

export function applyTheme(mode=savedThemeMode()){
  const theme=resolvedTheme(mode);
  document.documentElement.dataset.theme=theme;
  document.documentElement.dataset.themeMode=mode;
  document.documentElement.style.colorScheme=theme;
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--color-bg-primary').trim()||(theme==='dark'?'#0b1538':'#f5f8ff');
  document.documentElement.style.backgroundColor=bg;
  if(document.body)document.body.style.backgroundColor=bg;
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=bg;
  syncNative(theme);
  document.querySelectorAll('[data-cx-theme-toggle]').forEach(button=>{
    button.textContent=mode==='system'?'◐':mode==='dark'?'☾':'☀';
    button.title=`Theme: ${mode}. Tap to change.`;
    button.setAttribute('aria-label',`Theme: ${mode}. Tap to change.`);
  });
  return theme;
}

export function cycleTheme(){
  const current=savedThemeMode();
  const next=MODES[(MODES.indexOf(current)+1)%MODES.length];
  localStorage.setItem(KEY,next);
  applyTheme(next);
}

export function ensureThemeToggle(){
  if(!document.body||document.querySelector('[data-cx-theme-toggle]'))return;
  if(!document.getElementById('collectishUxShell'))return;
  const button=document.createElement('button');
  button.type='button';
  button.className='cx-theme-toggle';
  button.dataset.cxThemeToggle='1';
  button.addEventListener('click',cycleTheme);
  document.body.append(button);
  applyTheme();
}

export function installTheme(){
  applyTheme();
  media.addEventListener?.('change',()=>{if(savedThemeMode()==='system')applyTheme('system')});
  window.addEventListener('pageshow',()=>applyTheme());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)applyTheme()});
  document.addEventListener('collectish:shell-rendered',()=>{
    applyTheme();
    queueMicrotask(ensureThemeToggle);
  });
  document.addEventListener('collectish:ready',()=>queueMicrotask(ensureThemeToggle));
}

installTheme();
window.CollectishTheme={apply:applyTheme,cycle:cycleTheme,mode:savedThemeMode};
