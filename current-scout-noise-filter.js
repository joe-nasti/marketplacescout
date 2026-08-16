// Collectish Scout feed noise filter — hide sub-$2 Market rows unless EDHREC demand is surging.
(() => {
  const LOW_MARKET = 2;
  const STORAGE_KEY = 'collectishScoutHideLowMarket';
  let meta = new Map();
  let loading = false;
  let queued = false;

  function enabled(){
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v == null ? true : v !== 'false';
    } catch { return true; }
  }

  function setEnabled(v){
    try { localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false'); } catch {}
  }

  function isSurging(r){
    if (!r) return false;
    const signal = String(r.demand_signal || '').toLowerCase();
    if (signal.includes('surg')) return true;
    const edh = r.demand_sources?.edhrec || {};
    const text = JSON.stringify(edh).toLowerCase();
    return text.includes('surg');
  }

  async function loadMeta(){
    if (loading) return;
    loading = true;
    try {
      const rows = await rest('scout_opportunities_24h?select=sku_id,sku_market_price,demand_signal,demand_sources,demand_adjustment&order=opportunity_score.desc,observation_count.desc&limit=500');
      meta = new Map((rows || []).map(r => [String(r.sku_id || ''), r]));
    } catch (e) {
      console.warn('Scout low-market filter metadata unavailable', e);
    } finally {
      loading = false;
      apply();
    }
  }

  function ensureUi(){
    const page = document.getElementById('cxScout');
    const toolbar = page?.querySelector('.cx-scout-toolbar');
    if (!page || !toolbar) return null;
    let wrap = page.querySelector('.cx-scout-noise-filter');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'cx-scout-noise-filter';
      wrap.innerHTML = `<label><input type="checkbox" id="cxScoutHideLowMarket"> <span>Hide Market &lt; $${LOW_MARKET.toFixed(0)} unless surging</span></label><small id="cxScoutNoiseCount"></small>`;
      toolbar.insertAdjacentElement('afterend', wrap);
      const input = wrap.querySelector('#cxScoutHideLowMarket');
      input.checked = enabled();
      input.addEventListener('change', () => { setEnabled(input.checked); apply(); });
    }
    const input = wrap.querySelector('#cxScoutHideLowMarket');
    if (input) input.checked = enabled();
    return wrap;
  }

  function apply(){
    queued = false;
    const page = document.getElementById('cxScout');
    const host = document.getElementById('cxParityCards');
    if (!page || !host) return;
    const wrap = ensureUi();
    const hide = enabled();
    let hidden = 0, exceptions = 0, visible = 0;

    for (const card of host.querySelectorAll('.cx-scout-card')) {
      const sku = String(card.dataset.sku || '');
      const r = meta.get(sku);
      const market = Number(r?.sku_market_price);
      const low = Number.isFinite(market) && market >= 0 && market < LOW_MARKET;
      const surge = isSurging(r);
      const shouldHide = hide && low && !surge;
      card.classList.toggle('cx-scout-low-hidden', shouldHide);
      card.dataset.lowMarket = low ? 'true' : 'false';
      card.dataset.surging = surge ? 'true' : 'false';
      if (shouldHide) hidden++;
      else {
        visible++;
        if (low && surge) exceptions++;
      }
    }

    const count = wrap?.querySelector('#cxScoutNoiseCount');
    if (count) {
      if (!hide) count.textContent = 'Showing all Market prices';
      else count.textContent = `${hidden} low-value ${hidden === 1 ? 'row' : 'rows'} hidden${exceptions ? ` • ${exceptions} surging exception${exceptions === 1 ? '' : 's'} kept` : ''}`;
    }
  }

  function schedule(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }

  const style = document.createElement('style');
  style.textContent = `
    .cx-scout-low-hidden{display:none!important}
    .cx-scout-noise-filter{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 12px;padding:9px 11px;border:1px solid var(--cx-line);border-radius:12px;background:var(--cx-card);color:var(--cx-text)}
    .cx-scout-noise-filter label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;cursor:pointer}
    .cx-scout-noise-filter input{width:17px;height:17px;accent-color:var(--cx-blue,#2f6df6)}
    .cx-scout-noise-filter small{color:var(--cx-muted);font-size:10px;text-align:right}
    @media(max-width:640px){.cx-scout-noise-filter{align-items:flex-start;flex-direction:column;gap:4px}.cx-scout-noise-filter small{text-align:left}}
  `;
  document.head.appendChild(style);

  const mo = new MutationObserver(muts => {
    if (muts.some(m => m.target.id === 'cxParityCards' || m.target.closest?.('#cxScout'))) schedule();
    if (document.getElementById('cxParityCards') && !meta.size && !loading) loadMeta();
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});

  document.addEventListener('click',e => {
    if (e.target.closest?.('[data-cx-page="scout"]')) setTimeout(() => { ensureUi(); loadMeta(); }, 100);
  },true);

  setTimeout(() => { ensureUi(); loadMeta(); }, 150);
})();
