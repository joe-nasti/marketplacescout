const listeners=new Set();
let state={
  runtime:{phase:'booting'},
  session:null,
  navigation:{page:'scout'},
  scout:{health:null},
  sealed:{languageFilter:'all'}
};

export function getState(){return state}
export function setState(next){state=typeof next==='function'?next(state):next;notify();return state}
export function patchState(patch){state={...state,...patch};notify();return state}
export function updateSlice(key,patch){state={...state,[key]:{...(state[key]||{}),...patch}};notify();return state}
export function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)}
function notify(){for(const listener of listeners){try{listener(state)}catch(error){console.warn('Collectish state listener',error)}}}

export const store={get:getState,set:setState,patch:patchState,update:updateSlice,subscribe};
window.CollectishState=store;
export default store;
