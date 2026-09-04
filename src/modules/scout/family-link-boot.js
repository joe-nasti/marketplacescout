let installed=false,timer=null;

function request(){const p=new URL(location.href).searchParams,q=(p.get('q')||'').trim(),oracle=(p.get('oracle')||'').trim();return q&&/^[0-9a-f-]{36}$/i.test(oracle)?{q,oracle}:null}
function run(){const r=request(),input=document.getElementById('cxParitySearch');if(!r||!input||input.dataset.universalBound!=='1')return false;if(input.value!==r.q)input.value=r.q;input.dispatchEvent(new Event('input',{bubbles:true}));return true}
function schedule(){clearTimeout(timer);const waits=[0,90,240,520,950,1600];let i=0;const attempt=()=>{if(run())return;i++;if(i<waits.length)timer=setTimeout(attempt,waits[i])};attempt()}

export function installFamilyLinkBoot(){if(installed)return;installed=true;document.addEventListener('collectish:scout-structure-ready',schedule);document.addEventListener('collectish:page-change',schedule);document.addEventListener('collectish:ready',schedule);window.addEventListener('popstate',schedule);schedule()}
installFamilyLinkBoot();
export default installFamilyLinkBoot;
