const listeners=new Set();
let batchDepth=0,pendingNotify=false;
let state={
  runtime:{phase:'booting'},
  session:null,
  navigation:{page:'scout'},
  resources:{},
  scout:{health:null,filters:{query:'',grade:'',set:''},selectedSku:null},
  sealed:{view:'sets',selectedSetCode:null,filters:{query:'',status:'',setType:'',language:'all',buylistBacked:false},selectedId:null},
  seller:{},
  admin:{},
  ask:{}
};

export function getState(){return state}

function changed(a,b){return !Object.is(a,b)}
function flush(){
  if(batchDepth){pendingNotify=true;return}
  for(const entry of [...listeners]){
    try{
      const next=entry.selector(state);
      if(entry.immediate||changed(next,entry.last)){
        const prev=entry.last;
        entry.last=next;
        entry.immediate=false;
        entry.listener(next,prev,state);
      }
    }catch(error){console.warn('Collectish state listener',error)}
  }
}

export function batch(fn){
  batchDepth++;
  try{return fn()}
  finally{
    batchDepth--;
    if(!batchDepth&&pendingNotify){pendingNotify=false;flush()}
  }
}

export function setState(next){state=typeof next==='function'?next(state):next;flush();return state}
export function patchState(patch){state={...state,...patch};flush();return state}
export function updateSlice(key,patch){state={...state,[key]:{...(state[key]||{}),...patch}};flush();return state}

export function subscribe(selector,listener,options={}){
  if(typeof selector==='function'&&typeof listener!=='function'){
    listener=selector;
    selector=s=>s;
  }
  const entry={selector:selector||((s)=>s),listener,last:undefined,immediate:options.immediate!==false};
  listeners.add(entry);
  if(entry.immediate)flush();
  return()=>listeners.delete(entry);
}

export const store={
  get:getState,
  set:setState,
  patch:patchState,
  update:updateSlice,
  subscribe,
  batch
};
window.CollectishState=store;
export default store;
