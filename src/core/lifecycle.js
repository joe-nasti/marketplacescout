import store from '../state/store.js';

const components=new Map();
const mounted=new Set();
let appMounted=false;

export function registerComponent(id,{mount,unmount,onPage}={}){
  if(!id)throw new Error('Lifecycle component requires id');
  components.set(id,{mount,unmount,onPage});
  if(appMounted&&!mounted.has(id))mountComponent(id);
  return()=>{
    if(mounted.has(id))unmountComponent(id);
    components.delete(id);
  };
}

export function mountComponent(id){
  const component=components.get(id);
  if(!component||mounted.has(id))return;
  component.mount?.({store,lifecycle:api});
  mounted.add(id);
  component.onPage?.(store.get().navigation.page,{store,lifecycle:api});
}

export function unmountComponent(id){
  const component=components.get(id);
  if(!component||!mounted.has(id))return;
  try{component.unmount?.({store,lifecycle:api})}finally{mounted.delete(id)}
}

export function mountApp(){
  appMounted=true;
  for(const id of components.keys())mountComponent(id);
  store.update('runtime',{uiMounted:true});
}

export function unmountApp(){
  for(const id of [...mounted])unmountComponent(id);
  appMounted=false;
  store.update('runtime',{uiMounted:false});
}

export function setPage(page){
  if(!page)return;
  store.update('navigation',{page});
  for(const id of mounted){components.get(id)?.onPage?.(page,{store,lifecycle:api})}
}

export function isMounted(id){return mounted.has(id)}
export function getMounted(){return [...mounted]}

const api={registerComponent,mountComponent,unmountComponent,mountApp,unmountApp,setPage,isMounted,getMounted};
window.CollectishLifecycle=api;
export default api;
