let installed=false;
let loading=null;

export async function installScoutRenderer(){
  if(installed)return;
  if(loading)return loading;
  loading=import('../../../current-scout-v5-promoted.js').then(()=>{
    installed=true;
  }).finally(()=>{loading=null});
  return loading;
}

export default installScoutRenderer;
