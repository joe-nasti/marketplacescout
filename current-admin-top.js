// Collectish Admin back-to-top control — event-driven, no polling/network.
(() => {
  function ensure(){
    let b=document.getElementById('cxAdminTop');
    if(b)return b;
    b=document.createElement('button');
    b.id='cxAdminTop';b.className='cx-admin-top';b.type='button';b.textContent='↑ Top';
    b.addEventListener('click',()=>{const a=document.getElementById('cxAdmin');if(a){a.scrollIntoView({behavior:'smooth',block:'start'})}else window.scrollTo({top:0,behavior:'smooth'})});
    document.body.appendChild(b);return b;
  }
  function sync(){
    const b=ensure(),admin=document.getElementById('cxAdmin'),active=Boolean(admin?.classList.contains('active'));
    if(!active){b.classList.remove('show');return}
    const top=admin.getBoundingClientRect().top;
    b.classList.toggle('show',top < -280 || window.scrollY > 420);
  }
  let raf=0;function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;sync()})}
  window.addEventListener('scroll',schedule,{passive:true});
  document.addEventListener('scroll',schedule,{passive:true,capture:true});
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-page="admin"],[data-admin-tab]'))setTimeout(sync,80)},true);
  setTimeout(sync,250);
})();