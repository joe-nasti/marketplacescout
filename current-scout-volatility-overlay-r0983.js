// Scout SKU volatility overlay — bounded TCGplayer enrichment, conservative score adjustment.
(() => {
  let data=new Map(),loading=false,ready=false,timer=0;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const adjustment=v=>String(v||'').toUpperCase()==='HIGH'?-3:0;
  const grade=s=>s>=80?'A':s>=70?'B':s>=60?'C':s>=50?'D':'F';
  const label=v=>{const s=String(v||'').toUpperCase();return s==='MEDIUM'?'MED VOL':s==='HIGH'?'HIGH VOL':s==='LOW'?'LOW VOL':'VOL ?'};
  async function load(){if(loading)return;loading=true;try{const rows=await rest('scout_sku_volatility?select=sku_id,volatility,z_score,fetched_at&order=fetched_at.desc&limit=600');data=new Map((rows||[]).map(x=>[String(x.sku_id),x]));ready=true;decorate()}catch(e){console.warn('Scout volatility overlay',e)}finally{loading=false}}
  function applyCard(card){const sku=String(card.dataset.sku||'');const v=data.get(sku);if(!v)return;const top=card.querySelector('.cx-scout-card-top'),scoreEl=card.querySelector('.cx-score-mini'),gradeEl=card.querySelector('.cx-grade');if(!top||!scoreEl||!gradeEl)return;
    if(!scoreEl.dataset.volBase){const m=scoreEl.textContent.match(/Scout\s+(\d+)/i);if(!m)return;scoreEl.dataset.volBase=m[1]}
    const base=Number(scoreEl.dataset.volBase),adj=adjustment(v.volatility),score=Math.max(0,Math.min(100,base+adj)),g=grade(score);
    scoreEl.textContent=`Scout ${score}/100`;
    gradeEl.textContent=g;gradeEl.className=`cx-grade cx-grade-${g.toLowerCase()}`;
    let b=top.querySelector('[data-volatility-badge]');if(!b){b=document.createElement('span');b.dataset.volatilityBadge='1';b.className='cx-v5-badge';top.append(b)}
    b.textContent=`${label(v.volatility)}${adj?` ${adj}`:''}`;b.title=`TCGplayer SKU volatility${v.z_score==null?'':` · z ${Number(v.z_score).toFixed(2)}`} · fetched ${v.fetched_at?new Date(v.fetched_at).toLocaleString():'recently'}`;
    b.classList.toggle('verify',String(v.volatility).toUpperCase()==='HIGH');card.dataset.volatility=String(v.volatility||'');card.dataset.volatilityAdjustedScore=String(score);
  }
  function applyDetail(){const selected=document.querySelector('#cxParityCards .cx-scout-card.selected');const h=document.getElementById('cxParityDetail');if(!selected||!h)return;const v=data.get(String(selected.dataset.sku||''));if(!v)return;
    const badges=h.querySelector('.cx-v5-badges');if(badges&&!badges.querySelector('[data-volatility-detail]')){const s=document.createElement('span');s.dataset.volatilityDetail='1';s.className='cx-v5-badge';if(String(v.volatility).toUpperCase()==='HIGH')s.classList.add('verify');s.textContent=`${label(v.volatility)}${adjustment(v.volatility)?' · -3 score':''}`;s.title=`TCGplayer SKU-level market volatility${v.z_score==null?'':` · z ${Number(v.z_score).toFixed(2)}`}`;badges.append(s)}
    const details=h.querySelector('.cx-v5-details .cx-v5-grid');if(details&&!details.querySelector('[data-volatility-stat]')){const d=document.createElement('div');d.className='cx-v5-stat';d.dataset.volatilityStat='1';d.innerHTML=`<span>TCG volatility</span><strong>${esc(String(v.volatility||'—'))}</strong><small>${v.z_score==null?'SKU-level signal':`z-score ${Number(v.z_score).toFixed(2)}`}</small>`;details.append(d)}
  }
  function decorate(){if(!ready)return;document.querySelectorAll('#cxParityCards .cx-scout-card[data-sku]').forEach(applyCard);applyDetail()}
  function schedule(){clearTimeout(timer);timer=setTimeout(decorate,40)}
  function install(){const h=document.getElementById('cxScout');if(!h)return;new MutationObserver(schedule).observe(h,{childList:true,subtree:true});load()}
  document.addEventListener('collectish:scout-v5-ready',()=>{load();setTimeout(decorate,50)});
  document.addEventListener('collectish:ready',()=>setTimeout(install,0));if(document.getElementById('cxScout'))install();
  window.CollectishScoutVolatility={refresh:load,adjustment};
})();
