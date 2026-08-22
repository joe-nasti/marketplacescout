const PAGE_SET=new Set(['scout','signals','sealed','seller','syp','inventory','admin']);

export function readUrlState(){
  const u=new URL(location.href);
  const p=u.searchParams;
  return {
    tab:PAGE_SET.has(p.get('tab'))?p.get('tab'):'scout',
    sealed:{
      query:p.get('q')||'',
      status:p.get('status')||'',
      setType:p.get('settype')||'',
      setCode:(p.get('set')||'').toUpperCase(),
      language:parseLanguage(p.get('lang')),
      buylistBacked:parseBool(p.get('buylist_backed')),
      selectedId:p.get('sealed')||null
    }
  };
}

export function parseLanguage(value){
  const v=String(value||'').toLowerCase();
  if(!v||v==='all')return'all';
  if(v==='en'||v==='english'||v==='english_exact')return'english_exact';
  if(v==='nonenglish'||v==='non-en'||v==='nonenglish_exact')return'nonenglish_exact';
  if(v==='fallback')return'fallback';
  if(v==='nofallback'||v==='exclude_fallback')return'exclude_fallback';
  return'all';
}

export function serializeLanguage(value){
  return ({english_exact:'en',nonenglish_exact:'nonenglish',fallback:'fallback',exclude_fallback:'nofallback'})[value]||'all';
}

export function parseBool(value){
  const v=String(value||'').toLowerCase();
  return ['1','true','yes','on'].includes(v);
}

export function writeUrlState(patch,{replace=false}={}){
  const u=new URL(location.href),p=u.searchParams;
  if(Object.prototype.hasOwnProperty.call(patch,'tab'))setOrDelete(p,'tab',patch.tab==='scout'?'':patch.tab);
  if(patch.sealed){
    const s=patch.sealed;
    if(Object.prototype.hasOwnProperty.call(s,'query'))setOrDelete(p,'q',s.query);
    if(Object.prototype.hasOwnProperty.call(s,'status'))setOrDelete(p,'status',s.status);
    if(Object.prototype.hasOwnProperty.call(s,'setType'))setOrDelete(p,'settype',s.setType);
    if(Object.prototype.hasOwnProperty.call(s,'setCode'))setOrDelete(p,'set',String(s.setCode||'').toLowerCase());
    if(Object.prototype.hasOwnProperty.call(s,'language'))setOrDelete(p,'lang',serializeLanguage(s.language)==='all'?'':serializeLanguage(s.language));
    if(Object.prototype.hasOwnProperty.call(s,'buylistBacked'))setOrDelete(p,'buylist_backed',s.buylistBacked?'true':'');
    if(Object.prototype.hasOwnProperty.call(s,'selectedId'))setOrDelete(p,'sealed',s.selectedId);
  }
  const next=`${u.pathname}${p.toString()?`?${p}`:''}${u.hash}`;
  const current=`${location.pathname}${location.search}${location.hash}`;
  if(next===current)return;
  history[replace?'replaceState':'pushState']({},'',next);
}

function setOrDelete(params,key,value){
  if(value==null||value==='')params.delete(key);else params.set(key,String(value));
}

export function onUrlStateChange(listener){
  const handler=()=>listener(readUrlState());
  addEventListener('popstate',handler);
  return()=>removeEventListener('popstate',handler);
}
