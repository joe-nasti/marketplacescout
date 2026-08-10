// Collectish Marketplace Scout web v0.3.6 — reusable scan profile templates
(() => {
  const el=id=>document.getElementById(id);
  const KEY="collectishMobileProfileTemplatesV1";
  const DEFAULT={id:"default-both-nm-en-100",name:"Both / NM / English / Top 100",printing:"Both",condition:"Near Mint",language:"English",salesEnrich:100};
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.6";

  function loadTemplates(){
    try{const x=JSON.parse(localStorage.getItem(KEY)||"null");return Array.isArray(x)&&x.length?x:[DEFAULT]}catch{return [DEFAULT]}
  }
  function saveTemplates(x){localStorage.setItem(KEY,JSON.stringify(x))}
  function renderTemplates(selected=""){
    const sel=el("mobileProfileTemplate"); if(!sel)return;
    const t=loadTemplates();
    sel.innerHTML='<option value="">Custom</option>'+t.map(x=>`<option value="${x.id}">${x.name}</option>`).join("");
    if(selected&&t.some(x=>x.id===selected))sel.value=selected;
  }
  function applyTemplate(t){
    if(!t)return;
    el("newPrinting").value=t.printing||"Both";
    el("newCondition").value=t.condition||"Near Mint";
    el("newLanguage").value=t.language||"English";
    el("newEnrich").value=String(t.salesEnrich??100);
  }
  el("mobileProfileTemplate")?.addEventListener("change",()=>{
    const t=loadTemplates().find(x=>x.id===el("mobileProfileTemplate").value);if(t)applyTemplate(t);
  });
  el("mobileSaveTemplate")?.addEventListener("click",()=>{
    const name=prompt("Template name:",`${el("newPrinting").value} / ${el("newCondition").value} / ${el("newLanguage").value} / Top ${el("newEnrich").value}`);if(!name)return;
    const t=loadTemplates(),id=(crypto.randomUUID?crypto.randomUUID():String(Date.now()));
    t.push({id,name,printing:el("newPrinting").value,condition:el("newCondition").value,language:el("newLanguage").value,salesEnrich:Number(el("newEnrich").value||0)});
    saveTemplates(t);renderTemplates(id);
  });
  el("mobileDeleteTemplate")?.addEventListener("click",()=>{
    const id=el("mobileProfileTemplate")?.value;if(!id)return;
    saveTemplates(loadTemplates().filter(x=>x.id!==id));renderTemplates("");
  });

  renderTemplates("default-both-nm-en-100");
  applyTemplate(DEFAULT);
})();
