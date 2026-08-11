// Collectish Marketplace Scout web v0.3.9 — local-first card autocomplete
(() => {
  const el=id=>document.getElementById(id);
  const CACHE_KEY="collectishMobileCardAutocompleteV1",MAX_AGE=24*60*60*1000;
  let index=[];

  const norm=s=>String(s||"").normalize("NFKD").toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g," ").trim();
  function getCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||"null")}catch{return null}}
  function saveCache(rows){localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),rows}))}
  function dedupe(rows){
    const m=new Map();
    for(const r of rows||[]){
      if(!r.product_name)continue;const key=norm(r.product_name),x=m.get(key)||{name:r.product_name,key,skus:new Set(),products:new Set(),sets:new Set()};
      if(r.sku_id)x.skus.add(String(r.sku_id));if(r.product_id)x.products.add(String(r.product_id));if(r.set_name)x.sets.add(r.set_name);m.set(key,x);
    }
    return [...m.values()].map(x=>({...x,skus:[...x.skus],products:[...x.products],sets:[...x.sets]}));
  }
  async function refreshIndex(force=false){
    const cached=getCache();
    if(cached?.rows?.length){index=cached.rows}
    if(!force&&cached&&Date.now()-cached.savedAt<MAX_AGE)return;
    if(typeof rest!=="function")return;
    try{
      const rows=[];let offset=0;
      for(let page=0;page<10;page++){
        const chunk=await rest(`marketplace_scan_rows?select=product_name,sku_id,product_id,set_name&order=product_name.asc&limit=1000&offset=${offset}`);
        rows.push(...chunk);if(chunk.length<1000)break;offset+=1000;
      }
      index=dedupe(rows);saveCache(index);
    }catch(e){console.warn("Mobile autocomplete index",e)}
  }
  function matches(q,limit=10){
    q=norm(q);if(q.length<2)return[];const numeric=/^\d+$/.test(q),out=[];
    for(const x of index){let score=999;
      if(numeric){if(x.skus.includes(q)||x.products.includes(q))score=0;else if(x.skus.some(v=>v.startsWith(q))||x.products.some(v=>v.startsWith(q)))score=2}
      else if(x.key===q)score=0;else if(x.key.startsWith(q))score=1;else{const wi=x.key.split(" ").findIndex(w=>w.startsWith(q));if(wi>=0)score=2+wi*.01;else{const i=x.key.indexOf(q);if(i>=0)score=5+i/100}}
      if(score<999)out.push({x,score});
    }
    return out.sort((a,b)=>a.score-b.score||a.x.name.localeCompare(b.x.name)).slice(0,limit).map(v=>v.x);
  }
  function attach(id,{submit=false}={}){
    const input=el(id);if(!input||el(`${id}Autocomplete`))return;
    const wrap=document.createElement("div");wrap.className="mobile-autocomplete-wrap";input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
    const menu=document.createElement("div");menu.id=`${id}Autocomplete`;menu.className="mobile-autocomplete-menu";menu.hidden=true;wrap.appendChild(menu);
    let active=-1,current=[];
    const close=()=>{menu.hidden=true;menu.innerHTML="";active=-1};
    const choose=x=>{input.value=x.name;close();input.dispatchEvent(new Event("input",{bubbles:true}));if(submit)el("globalCardSearchBtn")?.click()};
    const render=()=>{current=matches(input.value);if(!current.length){close();return}menu.innerHTML=current.map((x,i)=>`<button type="button" class="mobile-autocomplete-item${i===active?" active":""}" data-i="${i}"><b>${x.name}</b><span>${[x.sets.slice(0,2).join(" • "),x.skus.length?`${x.skus.length} SKU${x.skus.length===1?"":"s"}`:""].filter(Boolean).join(" • ")}</span></button>`).join("");menu.hidden=false;menu.querySelectorAll("button").forEach(b=>b.addEventListener("pointerdown",e=>{e.preventDefault();choose(current[Number(b.dataset.i)])}))};
    input.addEventListener("input",render);input.addEventListener("focus",render);input.addEventListener("blur",()=>setTimeout(close,120));
    input.addEventListener("keydown",e=>{if(menu.hidden||!current.length)return;if(e.key==="ArrowDown"){e.preventDefault();active=(active+1)%current.length;render()}else if(e.key==="ArrowUp"){e.preventDefault();active=(active-1+current.length)%current.length;render()}else if(e.key==="Enter"&&active>=0){e.preventDefault();choose(current[active])}else if(e.key==="Escape")close()});
  }
  function addStyles(){if(el("mobileAutocompleteStyles"))return;const s=document.createElement("style");s.id="mobileAutocompleteStyles";s.textContent=`.mobile-autocomplete-wrap{position:relative;min-width:0;width:100%}.mobile-autocomplete-wrap>input{width:100%}.mobile-autocomplete-menu{position:absolute;left:0;right:0;top:calc(100% + 3px);z-index:200;background:#fff;border:1px solid #c8d0dc;border-radius:10px;box-shadow:0 8px 24px rgba(23,32,51,.18);max-height:320px;overflow:auto;padding:4px}.mobile-autocomplete-menu[hidden]{display:none}.mobile-autocomplete-item{display:flex;width:100%;flex-direction:column;align-items:flex-start;gap:2px;border:0;background:#fff;padding:10px;text-align:left;border-radius:7px}.mobile-autocomplete-item.active,.mobile-autocomplete-item:active{background:#edf4ff}.mobile-autocomplete-item span{font-size:10px;color:#718096}`;document.head.appendChild(s)}
  async function init(){addStyles();const cached=getCache();if(cached?.rows?.length)index=cached.rows;attach("globalCardSearch",{submit:true});attach("productHistorySearch");attach("moverSearch");await refreshIndex(false)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>init());else init();
})();
